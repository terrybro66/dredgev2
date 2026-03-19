import crypto from "crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  QueryPlanSchema,
  ResultContext,
  FallbackInfo,
  VizHintSchema,
} from "@dredge/schemas";
import { prisma } from "./db";
import { geocodeToPolygon } from "./geocoder";
import { evolveSchema } from "./schema";
import { parseIntent, deriveVizHint, expandDateRange } from "./crime/intent";
import { getDomainForQuery } from "./domains/registry";
import { generateFollowUps } from "./followups";
import { acquire } from "./rateLimiter";
import { AggregatedBin } from "@dredge/schemas";
import { shadowAdapter } from "./agent/shadow-adapter";
import { domainDiscovery } from "./agent/domain-discovery";
import { createSnapshot } from "./execution-model";
import { classifyIntent } from "./semantic/classifier";

export const queryRouter = Router();

const ParseBodySchema = z.object({ text: z.string().min(1) });

const ExecuteBodySchema = z.object({
  plan: QueryPlanSchema,
  poly: z.string(),
  viz_hint: VizHintSchema,
  resolved_location: z.string(),
  country_code: z.string(),
  intent: z.string().default("unknown"),
  months: z.array(z.string()),
  rawText: z.string().optional(),
});
// ── POST /parse ───────────────────────────────────────────────────────────────

queryRouter.post("/parse", async (req: Request, res: Response) => {
  const bodyResult = ParseBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res
      .status(400)
      .json({ error: "validation_error", details: bodyResult.error.errors });
  }
  const { text } = bodyResult.data;

  let plan;
  try {
    plan = await parseIntent(text);
  } catch (err: any) {
    return res.status(400).json(err);
  }

  let geocoded;
  try {
    geocoded = await geocodeToPolygon(plan.location, prisma);
  } catch (err: any) {
    return res.status(400).json(err);
  }

  const intentKeywords = [
    "weather",
    "temperature",
    "forecast",
    "rain",
    "wind",
    "precipitation",
  ];
  const weatherMatch = intentKeywords.some((k) =>
    text.toLowerCase().includes(k),
  );

  const crimeKeywords = [
    "crime",
    "burglary",
    "burglaries",
    "theft",
    "robbery",
    "drug",
    "assault",
    "violence",
    "violent",
    "antisocial",
    "anti-social",
    "criminal",
    "offence",
    "offences",
    "incident",
    "incidents",
  ];
  const crimeMatch = crimeKeywords.some((k) => text.toLowerCase().includes(k));

  let intent = weatherMatch ? "weather" : crimeMatch ? "crime" : undefined;

  // Phase 10 — use semantic classifier if enabled, fall back to keyword matching
  if (classifyIntent !== null) {
    try {
      const classified = await classifyIntent(text, prisma);
      if (classified.confidence >= 0.5 && classified.domain) {
        intent = classified.intent;
        console.log(
          JSON.stringify({
            event: "semantic_intent_classified",
            intent,
            domain: classified.domain,
            confidence: classified.confidence,
          }),
        );
      }
    } catch {
      // classifier failure is non-fatal — fall back to keyword matching
    }
  }
  const viz_hint = deriveVizHint(plan, text, intent ?? "crime");
  const months = expandDateRange(plan.date_from, plan.date_to);

  return res.json({
    plan,
    poly: geocoded.poly,
    viz_hint,
    resolved_location: geocoded.display_name,
    country_code: geocoded.country_code,
    intent,
    months,
  });
});

// ── POST /execute ─────────────────────────────────────────────────────────────

queryRouter.post("/execute", async (req: Request, res: Response) => {
  const bodyResult = ExecuteBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res
      .status(400)
      .json({ error: "validation_error", details: bodyResult.error.errors });
  }

  const {
    plan,
    poly,
    viz_hint,
    resolved_location,
    country_code,
    intent,
    months,
    rawText,
  } = bodyResult.data;

  // 1. Resolve adapter via intent + country routing
  let adapter = intent ? getDomainForQuery(country_code, intent) : undefined;
  if (!adapter) {
    if (domainDiscovery.isEnabled()) {
      const discoveryIntent =
        rawText ??
        (intent === "unknown"
          ? `${plan.category} in ${plan.location}`
          : intent);
      await domainDiscovery.run(
        { intent: discoveryIntent, country_code },
        prisma,
      );
    }
    return res.status(400).json({
      error: "unsupported_region",
      message: `No data source available for country: ${country_code} / intent: ${intent}. Discovery pipeline triggered — check admin for review.`,
      country_code,
      discovery_triggered: domainDiscovery.isEnabled(),
    });
  }

  // 2. Compute deterministic cache hash
  const hashInput = JSON.stringify({
    domain: adapter.config.name,
    category: plan.category,
    date_from: plan.date_from,
    date_to: plan.date_to,
    resolved_location: resolved_location.toLowerCase(),
  });
  const query_hash = crypto
    .createHash("sha256")
    .update(hashInput)
    .digest("hex");

  let cached = await prisma.queryCache.findUnique({ where: { query_hash } });

  if (cached && adapter.config.cacheTtlHours != null) {
    const ageHours = (Date.now() - cached.createdAt.getTime()) / 3600000;

    if (ageHours > adapter.config.cacheTtlHours) {
      await prisma.queryCache.delete({ where: { query_hash } });

      console.log(
        JSON.stringify({
          event: "cache_stale_evicted",
          domain: adapter.config.name,
          query_hash,
        }),
      );

      cached = null;
    }
  }

  if (cached) {
    const queryRecord = await prisma.query.create({
      data: {
        text: `${plan.category} in ${plan.location}`,
        category: plan.category,
        date_from: plan.date_from,
        date_to: plan.date_to,
        poly,
        viz_hint,
        domain: adapter.config.name,
        country_code,
        resolved_location,
      },
    });
    await prisma.queryJob.create({
      data: {
        query_id: queryRecord.id,
        status: "complete",
        domain: adapter.config.name,
        cache_hit: true,
        rows_inserted: cached.result_count,
        completedAt: new Date(),
      },
    });
    console.log(
      JSON.stringify({
        event: "execute",
        cache_hit: true,
        domain: adapter.config.name,
        query_hash,
        result_count: cached.result_count,
      }),
    );

    const followUps = generateFollowUps({
      domain: adapter.config.name,
      plan,
      poly,
      viz_hint,
      resolved_location,
      country_code,
      intent,
      months,
      resultCount: cached.result_count,
    });

    const resultContext: ResultContext = {
      status: "exact",
      followUps,
      confidence: "high",
    };

    const aggregated = viz_hint === "map" || viz_hint === "heatmap";

    return res.json({
      query_id: queryRecord.id,
      plan,
      poly,
      viz_hint,
      resolved_location,
      count: cached.result_count,
      months_fetched: months,
      results: cached.results,
      cache_hit: true,
      aggregated,
      resultContext,
    });
  }

  // 4. Live execution (cache miss)
  let queryRecord;
  try {
    queryRecord = await prisma.query.create({
      data: {
        text: `${plan.category} in ${plan.location}`,
        category: plan.category,
        date_from: plan.date_from,
        date_to: plan.date_to,
        poly,
        viz_hint,
        domain: adapter.config.name,
        country_code,
        resolved_location,
      },
    });
  } catch (err: any) {
    console.error("[execute] prisma.query.create failed:", err);
    return res.status(500).json({ error: "db_error", message: err.message });
  }

  const job = await prisma.queryJob.create({
    data: {
      query_id: queryRecord.id,
      status: "pending",
      domain: adapter.config.name,
      cache_hit: false,
    },
  });

  try {
    const fetch_start = Date.now();
    await acquire(adapter.config);
    let rows = await adapter.fetchData(plan, poly);
    const fetch_ms = Date.now() - fetch_start;

    // 5. Recovery — attempt fallback strategies when fetch returned nothing
    let fallback: FallbackInfo | undefined;
    let effectiveMonths = months;

    if (rows.length === 0 && adapter.recoverFromEmpty) {
      const recovery = await adapter.recoverFromEmpty(plan, poly, prisma);
      if (recovery) {
        rows = recovery.data;
        fallback = recovery.fallback;
        if (fallback.field === "date") {
          effectiveMonths = [fallback.used];
        }
      }
    }

    if (rows.length === 0 && shadowAdapter.isEnabled()) {
      const shadow = await shadowAdapter.recover(
        adapter.config,
        {
          intent,
          location: resolved_location,
          country_code,
          date_range: plan.date_from,
        },
        prisma,
      );
      if (shadow) {
        rows = shadow.data;
        fallback = shadow.fallback;
        if (shadow.newSource) {
          await prisma.apiAvailability.upsert({
            where: {
              source: `${adapter.config.name}:shadow:${shadow.newSource.sourceUrl}`,
            },
            update: {
              sourceUrl: shadow.newSource.sourceUrl,
              providerType: shadow.newSource.providerType,
              confidence: shadow.newSource.confidence,
              lastUsedAt: new Date(),
            },
            create: {
              source: `${adapter.config.name}:shadow:${shadow.newSource.sourceUrl}`,
              months: [],
              sourceUrl: shadow.newSource.sourceUrl,
              providerType: shadow.newSource.providerType,
              confidence: shadow.newSource.confidence,
              shadowDiscovered: true,
              lastUsedAt: new Date(),
            },
          });
        }
      }
    }

    const store_start = Date.now();
    if (rows.length > 0) {
      await evolveSchema(
        prisma,
        adapter.config.tableName,
        rows[0] as Record<string, unknown>,
        queryRecord.id,
        adapter.config.name,
      );
    }

    await adapter.storeResults(queryRecord.id, rows, prisma);
    const store_ms = Date.now() - store_start;

    // Phase 8.5 — seal an immutable snapshot for this execution
    await createSnapshot({
      queryId: queryRecord.id,
      sourceSet: adapter.config.sources?.map((s) => s.url) ?? [
        adapter.config.apiUrl,
      ],
      schemaVersion: "1.0",
      rows,
      prisma,
    });

    let aggregated = false;
    let storedResults: unknown[];

    if (viz_hint === "map" || viz_hint === "heatmap") {
      const bins = await prisma.$queryRaw<AggregatedBin[]>`
 SELECT ST_Y(centroid)::float AS lat, ST_X(centroid)::float AS lon, count
FROM (
  SELECT 
    ST_Centroid(ST_Collect(ST_MakePoint(longitude, latitude))) AS centroid,
    COUNT(*)::int AS count
  FROM crime_results
  WHERE query_id = ${queryRecord.id}
    AND latitude IS NOT NULL
    AND longitude IS NOT NULL
  GROUP BY ST_SnapToGrid(ST_MakePoint(longitude, latitude), 0.002)
) grouped
  `;

      storedResults = bins;
      aggregated = true;
    } else {
      storedResults = await (prisma as any)[
        adapter.config.prismaModel
      ].findMany({
        where: { query_id: queryRecord.id },
        orderBy: { month: "asc" },
      });
    }
    await prisma.queryCache.create({
      data: {
        query_hash,
        domain: adapter.config.name,
        result_count: storedResults.length,
        results: storedResults as any,
      },
    });
    if (viz_hint === "bar") {
      // Group by month for the bar chart — don't slice raw rows
      const byMonth: Record<string, number> = {};
      for (const row of storedResults as any[]) {
        const month = row.month ?? "unknown";
        byMonth[month] = (byMonth[month] ?? 0) + 1;
      }
      storedResults = Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, count]) => ({ month, count }));
    } else if (viz_hint === "table") {
      storedResults = storedResults.slice(0, 100);
    }
    await prisma.queryJob.update({
      where: { id: job.id },
      data: {
        status: "complete",
        rows_inserted: storedResults.length,
        fetch_ms,
        store_ms,
        completedAt: new Date(),
        fallback_applied: fallback?.field ?? null,
        fallback_success: fallback ? storedResults.length > 0 : null,
      },
    });

    console.log(
      JSON.stringify({
        event: "execute",
        cache_hit: false,
        domain: adapter.config.name,
        query_hash,
        fetch_ms,
        store_ms,
        rows_inserted: storedResults.length,
        fallback_applied: fallback?.field ?? null,
      }),
    );

    // 6. Build resultContext
    const followUps = generateFollowUps({
      domain: adapter.config.name,
      plan,
      poly,
      viz_hint,
      resolved_location,
      country_code,
      intent,
      months: effectiveMonths,
      resultCount: storedResults.length,
    });

    const resultContext: ResultContext =
      storedResults.length === 0
        ? { status: "empty", followUps, confidence: "low" }
        : fallback
          ? { status: "fallback", fallback, followUps, confidence: "medium" }
          : { status: "exact", followUps, confidence: "high" };

    return res.json({
      query_id: queryRecord.id,
      plan,
      poly,
      viz_hint,
      resolved_location,
      count: storedResults.length,
      months_fetched: effectiveMonths,
      results: storedResults,
      cache_hit: false,
      aggregated,
      resultContext,
    });
  } catch (err: any) {
    await prisma.queryJob.update({
      where: { id: job.id },
      data: {
        status: "error",
        error_message: err.message,
        completedAt: new Date(),
      },
    });
    console.log(
      JSON.stringify({
        event: "execute_error",
        domain: adapter.config.name,
        error: err.message,
      }),
    );
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

queryRouter.get("/:id", async (req: Request, res: Response) => {
  const record = await prisma.query.findUnique({
    where: { id: req.params.id },
    include: { results: true },
  });

  if (!record) {
    return res.status(404).json({ error: "not_found" });
  }

  return res.json(record);
});
