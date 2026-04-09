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
import { parseIntent, deriveVizHint, expandDateRange } from "./intent";
import { getDomainForQuery, DomainAdapter } from "./domains/registry";
import { generateFollowUps } from "./followups";
import { acquire } from "./rateLimiter";
import { AggregatedBin } from "@dredge/schemas";
import { shadowAdapter } from "./agent/shadow-adapter";
import { domainDiscovery } from "./agent/domain-discovery";
import { createSnapshot } from "./execution-model";
import { classifyIntent } from "./semantic/classifier";
import { findCuratedSource, SearchStrategy } from "./curated-registry";
import { createRestProvider } from "./providers/rest-provider";
import { tagRows } from "./enrichment/source-tag";
import { suggestFollowups } from "./suggest-followups";
import { buildClarificationRequest } from "./clarification";
import { getRegulatoryAdapter } from "./regulatory-adapter";
import {
  updateQueryContext,
  getQueryContext,
  pushResultHandle,
  createEphemeralHandle,
} from "./conversation-memory";
import { recordCoOccurrence } from "./co-occurrence-log";
import { setUserLocation, getUserLocation } from "./session";
import { getWorkflowById, findWorkflowsForIntent } from "./workflow-templates";
import { executeWorkflow } from "./workflow-executor";

// ── Co-occurrence recording helper — D.13 ────────────────────────────────────
//
// Fire-and-forget — never throws, never blocks a response.
// Call after every successful domain fetch so the learning system accumulates
// real co-occurrence signal from user sessions.

async function recordDomainCoOccurrence(
  sessionId: string | null,
  currentDomain: string,
): Promise<void> {
  if (!sessionId) return;
  try {
    const ctx = await getQueryContext(sessionId);
    const priorDomains = (ctx?.result_stack ?? [])
      .map((h) => h.domain)
      .filter((d): d is string => typeof d === "string" && d.length > 0)
      .slice(0, 3);

    if (priorDomains.length > 0) {
      await recordCoOccurrence([currentDomain, ...priorDomains]);
    }

    // Push a lightweight marker so subsequent queries can see this domain
    const handle = createEphemeralHandle([], currentDomain);
    await pushResultHandle(sessionId, handle);
  } catch {
    // Non-fatal — co-occurrence failure must never affect the query response
  }
}

export const queryRouter = Router();

const ParseBodySchema = z.object({ text: z.string().min(1) });

const ExecuteBodySchema = z.object({
  plan: QueryPlanSchema,
  poly: z.string().default(""),
  viz_hint: VizHintSchema,
  resolved_location: z.string(),
  country_code: z.string(),
  intent: z.string().default("unknown"),
  months: z.array(z.string()),
  rawText: z.string().optional(),
  // D.6 — user attributes collected via ClarificationRequest answers
  user_attributes: z.record(z.unknown()).optional(),
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

  const sessionId = (req.headers["x-session-id"] as string | undefined) ?? null;

  // Detect "near me" — if the LLM returned a near-me placeholder, substitute
  // the location stored from the user's last real query.
  const NEAR_ME_PATTERN =
    /\bnear\s+me\b|\bmy\s+location\b|\bmy\s+area\b|\bnearby\b/i;
  if (NEAR_ME_PATTERN.test(plan.location) || NEAR_ME_PATTERN.test(text)) {
    if (sessionId) {
      const stored = await getUserLocation(sessionId);
      if (stored) {
        plan = {
          ...plan,
          location: stored.display_name,
        };
      }
    }
  }

  let geocoded;
  try {
    geocoded = await geocodeToPolygon(plan.location, prisma);
  } catch (err: any) {
    return res.status(400).json(err);
  }

  // Store resolved location for future "near me" queries
  if (sessionId && !NEAR_ME_PATTERN.test(text)) {
    await setUserLocation(sessionId, {
      lat: geocoded.lat,
      lon: geocoded.lon,
      display_name: geocoded.display_name,
      country_code: geocoded.country_code,
    });
  }

  let intent: string | undefined;

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
      // classifier failure is non-fatal — intent remains undefined, triggering discovery
    }
  }

  const viz_hint = deriveVizHint(plan, text, intent ?? "unknown");
  const months = expandDateRange(plan.date_from, plan.date_to);

  const suggestedWorkflows = findWorkflowsForIntent(text);
  const suggested_workflow =
    suggestedWorkflows.length > 0
      ? {
          workflow_id: suggestedWorkflows[0].id,
          workflow_name: suggestedWorkflows[0].name,
          description: suggestedWorkflows[0].description,
          input_schema: suggestedWorkflows[0].input_schema,
        }
      : undefined;

  return res.json({
    plan,
    poly: geocoded.poly,
    viz_hint,
    resolved_location: geocoded.display_name,
    country_code: geocoded.country_code,
    intent,
    months,
    ...(suggested_workflow ? { suggested_workflow } : {}),
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
    user_attributes,
  } = bodyResult.data;

  const sessionId = (req.headers["x-session-id"] as string | undefined) ?? null;
  const userAttributes = user_attributes ?? {};
  const clarificationText = rawText ?? intent ?? plan.category ?? "";

  // 0. Clarification check — regulatory/eligibility intents return questions
  //    before any data fetch. Only run when the user has not yet answered;
  //    once user_attributes are populated we skip straight to evaluation.
  if (Object.keys(userAttributes).length === 0) {
    const clarificationRequest = buildClarificationRequest(clarificationText);
    if (clarificationRequest) {
      return res.status(200).json({
        type: "clarification",
        request: clarificationRequest,
      });
    }
  }

  // 0b. Regulatory adapter check — when user_attributes are present evaluate
  //     eligibility and return a decision_result without fetching any data.
  const regulatoryAdapter = getRegulatoryAdapter(
    clarificationText,
    country_code,
  );
  if (regulatoryAdapter && Object.keys(userAttributes).length > 0) {
    const decision = await regulatoryAdapter.evaluate(userAttributes);

    // D.6 — persist answered attributes to session context
    if (sessionId) {
      await updateQueryContext(sessionId, {
        active_filters: { ...userAttributes },
      });
    }

    return res.status(200).json({
      type: "decision_result",
      decision,
      intent: clarificationText,
    });
  }

  // 1. Resolve adapter via intent + country routing
  // Use classified intent, fall back to plan.category before giving up.
  const resolvedIntent =
    intent && intent !== "unknown"
      ? intent
      : plan.category && plan.category !== "unknown"
        ? plan.category
        : undefined;

  // Map crime subcategories to the registered intent slug.
  // The LLM returns "burglary" as category but the registry uses "crime".
  // Similarly, LLM variants of other intents are normalised here.
  const CATEGORY_TO_INTENT: Record<string, string> = {
    burglary: "crime",
    "all-crime": "crime",
    drugs: "crime",
    robbery: "crime",
    "violent-crime": "crime",
    "bicycle-theft": "crime",
    "anti-social-behaviour": "crime",
    "vehicle-crime": "crime",
    flooding: "flood risk",
    "flood warnings": "flood risk",
    "flood alerts": "flood risk",
    "flood risk": "flood risk",
    shoplifting: "crime",
    "criminal-damage-arson": "crime",
    "other-theft": "crime",
    "possession-of-weapons": "crime",
    "public-order": "crime",
    "theft-from-the-person": "crime",
    "other-crime": "crime",
  };
  const routingIntent =
    CATEGORY_TO_INTENT[resolvedIntent ?? ""] ?? resolvedIntent;

  let adapter: DomainAdapter | undefined = routingIntent
    ? getDomainForQuery(country_code, routingIntent)
    : undefined;

  if (!adapter) {
    // 1b. Check curated registry before falling through to discovery
    const curatedSource = routingIntent
      ? findCuratedSource(routingIntent, country_code)
      : null;

    if (curatedSource) {
      // Skip background discovery for scrape-type curated sources — the curated
      // entry IS the definitive source, discovery would only find garbage URLs.
      // Only trigger discovery for REST/CSV sources where a better adapter might exist.
      if (domainDiscovery.isEnabled() && curatedSource.type !== "scrape") {
        domainDiscovery
          .run({ intent: routingIntent ?? plan.category, country_code }, prisma)
          .catch(() => {}); // non-fatal
      }

      // Build an on-the-fly adapter from the curated source
      const source = curatedSource; // capture for closures
      adapter = {
        config: {
          name: source.name,
          tableName: "query_results",
          prismaModel: "queryResult",
          storeResults: source.storeResults,
          countries: source.countryCodes,
          intents: [source.intent],
          apiUrl: source.url,
          apiKeyEnv: null,
          locationStyle: "coordinates",
          params: {},
          flattenRow: source.fieldMap,
          categoryMap: {},
          vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
          cacheTtlHours: null,
        },

        async fetchData(
          _plan: unknown,
          _locationArg: string,
        ): Promise<unknown[]> {
          try {
            if (source.type === "scrape") {
              const { createScrapeProvider } =
                await import("./providers/scrape-provider");
              const { resolveUrlForQuery } =
                await import("./agent/search/serp");

              let fetchUrl = source.url ?? "";
              let extractionPrompt = source.extractionPrompt ?? "";

              if ((source as any).searchStrategy) {
                const strategy = (source as any)
                  .searchStrategy as SearchStrategy;
                const { getCachedScrapeUrl, setCachedScrapeUrl } =
                  await import("./agent/search/scrape-url-cache");
                const { generateExtractionPrompt } =
                  await import("./agent/search/extraction-prompt-generator");

                // Use resolved_location when available; fall back to country
                // name so bare queries ("cinema listings") don't return US results
                const COUNTRY_NAMES: Record<string, string> = {
                  GB: "UK",
                  US: "USA",
                  AU: "Australia",
                  CA: "Canada",
                  IE: "Ireland",
                };
                const locationContext =
                  resolved_location && resolved_location.trim()
                    ? resolved_location
                    : (COUNTRY_NAMES[country_code] ?? country_code);

                // Check cache first — saves a SerpAPI call on repeat queries
                const cached = await getCachedScrapeUrl(
                  source.intent,
                  locationContext,
                );

                if (cached) {
                  console.log(
                    JSON.stringify({
                      event: "scrape_url_cache_hit",
                      url: cached.url,
                      intent: source.intent,
                      location: locationContext,
                    }),
                  );
                  fetchUrl = cached.url;
                  extractionPrompt = cached.extractionPrompt;
                } else {
                  const serpQuery = strategy.queryTemplate
                    .replace("{intent}", source.intent)
                    .replace("{location}", locationContext);

                  console.log(
                    JSON.stringify({
                      event: "scrape_url_resolving",
                      query: serpQuery,
                    }),
                  );
                  fetchUrl =
                    (await resolveUrlForQuery(
                      serpQuery,
                      strategy.preferredDomains ?? [],
                    )) ?? "";

                  if (!fetchUrl) {
                    console.warn(
                      JSON.stringify({
                        event: "scrape_url_not_found",
                        query: serpQuery,
                      }),
                    );
                    return [];
                  }

                  console.log(
                    JSON.stringify({
                      event: "scrape_url_resolved",
                      url: fetchUrl,
                    }),
                  );

                  // Generate extraction prompt if not curated
                  if (!extractionPrompt) {
                    extractionPrompt = await generateExtractionPrompt(
                      source.intent,
                    );
                    console.log(
                      JSON.stringify({
                        event: "scrape_prompt_generated",
                        intent: source.intent,
                      }),
                    );
                  }

                  // Populate cache for next time
                  await setCachedScrapeUrl(source.intent, locationContext, {
                    url: fetchUrl,
                    extractionPrompt,
                  });
                }
              }
              // Fallback: generate prompt for static-URL scrape sources
              // that have no curated extractionPrompt and no searchStrategy
              if (!extractionPrompt) {
                const { generateExtractionPrompt } =
                  await import("./agent/search/extraction-prompt-generator");
                extractionPrompt = await generateExtractionPrompt(
                  source.intent,
                );
                console.log(
                  JSON.stringify({
                    event: "scrape_prompt_generated_static",
                    intent: source.intent,
                  }),
                );
              }

              const provider = createScrapeProvider({ extractionPrompt });
              return tagRows(
                (await provider.fetchRows(fetchUrl)) as Record<
                  string,
                  unknown
                >[],
                fetchUrl,
              );
            }

            const restUrl = source.url ?? "";
            const provider = createRestProvider({ url: restUrl });
            const rows = await provider.fetchRows();
            return tagRows(rows as Record<string, unknown>[], restUrl);
          } catch {
            return [];
          }
        },

        flattenRow(row: unknown): Record<string, unknown> {
          return row as Record<string, unknown>;
        },

        async storeResults(
          queryId: string,
          rows: unknown[],
          prismaClient: any,
        ): Promise<void> {
          if (!source.storeResults || rows.length === 0) return;
          await prismaClient.queryResult.createMany({
            data: (rows as Record<string, unknown>[]).map((row) => ({
              domain_name: source.name,
              source_tag:
                (row._sourceTag as string) ??
                (row.source_tag as string) ??
                source.name,
              date: row.date
                ? new Date(row.date as string)
                : row.timeRaised
                  ? new Date(row.timeRaised as string)
                  : null,
              lat: ((row.lat ?? row.latitude) as number) ?? null,
              lon: ((row.lon ?? row.longitude) as number) ?? null,
              location:
                (row.location as string) ?? (row.eaAreaName as string) ?? null,
              description: (row.description as string) ?? null,
              category:
                (row.category as string) ?? (row.severity as string) ?? null,
              value: (row.value as number) ?? null,
              raw: (row.raw as object) ?? row,
              extras: (row.extras as object) ?? null,
              snapshot_id: null,
            })),
          });
        },
      };
    } else {
      // 1c. Fall through to discovery pipeline
      if (domainDiscovery.isEnabled()) {
        const discoveryIntent =
          resolvedIntent && resolvedIntent !== "unknown"
            ? resolvedIntent
            : plan.category !== "unknown"
              ? plan.category
              : `${plan.category} in ${plan.location}`;
        // Non-blocking — don't await so the user gets a fast response
        domainDiscovery
          .run({ intent: discoveryIntent, country_code }, prisma)
          .catch(() => {});
      }
      return res.status(200).json({
        error: "not_supported",
        message:
          routingIntent && routingIntent !== "unknown"
            ? `We don't have a data source for "${routingIntent}" yet. We've added it to our review queue.`
            : `We couldn't understand that query. Try asking about crime, weather, flooding, transport, cinema listings, or population statistics.`,
        supported: [
          "crime",
          "weather",
          "flood risk",
          "transport",
          "cinema listings",
          "population statistics",
        ],
        discovery_triggered: domainDiscovery.isEnabled(),
      });
    }
  }

  // 2. Ephemeral adapters bypass cache, storage and snapshots entirely
  const isEphemeral = adapter.config.storeResults === false;

  if (isEphemeral) {
    // Create job record for observability, then fetch live and return directly
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
        intent: resolvedIntent ?? null,
      },
    });
    const job = await prisma.queryJob.create({
      data: {
        query_id: queryRecord.id,
        status: "pending",
        domain: adapter.config.name,
        cache_hit: false,
      },
    });
    try {
      await acquire(adapter.config);
      const rows = await adapter.fetchData(plan, poly);
      let liveResults: unknown[] = rows;
      if (viz_hint === "bar") {
        const byMonth: Record<string, number> = {};
        for (const row of rows as any[]) {
          const month = row.month ?? row.date ?? "unknown";
          byMonth[month] = (byMonth[month] ?? 0) + 1;
        }
        liveResults = Object.entries(byMonth)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, count]) => ({ month, count }));
      } else if (viz_hint === "table") {
        liveResults = liveResults.slice(0, 100);
      }
      await prisma.queryJob.update({
        where: { id: job.id },
        data: {
          status: "complete",
          rows_inserted: liveResults.length,
          completedAt: new Date(),
        },
      });
      return res.json({
        query_id: queryRecord.id,
        plan,
        poly,
        viz_hint,
        resolved_location,
        count: liveResults.length,
        months_fetched: months,
        results: liveResults,
        cache_hit: false,
        ephemeral: true,
        aggregated: false,
        resultContext: {
          status: liveResults.length === 0 ? "empty" : "exact",
          followUps: [],
          confidence: liveResults.length === 0 ? "low" : "high",
        },
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
      return res.status(500).json({ error: err.message });
    }
  }

  // 3. Compute deterministic cache hash (persistent adapters only)
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
        intent: resolvedIntent ?? null,
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

    const chips = suggestFollowups({
      rows: cached.results as unknown[],
      domain: adapter.config.name,
      handleId: `qr_${queryRecord.id}`,
      ephemeral: false,
      memory: {
        context: {
          location: null,
          active_plan: plan,
          result_stack: [],
          active_filters: {},
        },
        profile: { user_attributes: {}, location_history: [] },
      },
    });

    const resultContext: ResultContext = {
      status: "exact",
      followUps,
      confidence: "high",
    };

    const aggregated = viz_hint === "map" || viz_hint === "heatmap";

    recordDomainCoOccurrence(sessionId, adapter.config.name).catch(() => {});

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
      chips,
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
        intent: resolvedIntent ?? null,
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
    let isShadowRecovery = false;
    let effectiveMonths =
      adapter.config.temporality === "time-series" ? months : [];

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
        isShadowRecovery = true;

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

    if (!isEphemeral) {
      if (isShadowRecovery) {
        if (rows.length > 0) {
          await (prisma as any).queryResult.createMany({
            data: (rows as Record<string, unknown>[]).map((row) => ({
              query_id: queryRecord.id,
              domain_name: adapter.config.name,
              source_tag: (row._sourceTag as string) ?? adapter.config.name,
              date: row.date
                ? new Date(row.date as string)
                : row.month
                  ? new Date(`${row.month as string}-01`)
                  : null,
              lat:
                row.lat != null
                  ? parseFloat(String(row.lat))
                  : row.latitude != null
                    ? parseFloat(String(row.latitude))
                    : null,
              lon:
                row.lon != null
                  ? parseFloat(String(row.lon))
                  : row.longitude != null
                    ? parseFloat(String(row.longitude))
                    : null,
              location: (row.location as string) ?? null,
              description: (row.description as string) ?? null,
              category:
                (row.category as string) ?? (row.type as string) ?? null,
              value: row.value != null ? parseFloat(String(row.value)) : null,
              raw: (row.raw as object) ?? row,
              extras: (row.extras as object) ?? null,
              snapshot_id: null,
            })),
          });
        }
      } else {
        if (rows.length > 0) {
          await adapter.storeResults(queryRecord.id, rows, prisma);
        }
      }
    }

    const store_ms = Date.now() - store_start;

    if (!isEphemeral) {
      await createSnapshot({
        queryId: queryRecord.id,
        sourceSet: adapter.config.sources?.map((s) => s.url) ?? [
          adapter.config.apiUrl,
        ],
        schemaVersion: "1.0",
        rows,
        prisma,
      });
    }

    let aggregated = false;
    let storedResults: unknown[];

    if (isEphemeral || isShadowRecovery) {
      storedResults = rows;
    } else if (viz_hint === "map" || viz_hint === "heatmap") {
      if (adapter.config.tableName === "crime_results") {
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
      } else {
        // Generic path — reads from query_results using domain_name
        storedResults = await prisma.queryResult.findMany({
          where: { domain_name: adapter.config.name },
          orderBy: { created_at: "desc" },
          take: 500,
        });
      }
      aggregated = true;
    } else {
      storedResults = await (prisma as any)[
        adapter.config.prismaModel
      ].findMany({
        where: { query_id: queryRecord.id },
        orderBy: (adapter.config.defaultOrderBy ?? { date: "asc" }) as any,
      });
    }

    if (!isEphemeral && !isShadowRecovery) {
      await prisma.queryCache.create({
        data: {
          query_hash,
          domain: adapter.config.name,
          result_count: storedResults.length,
          results: storedResults as any,
        },
      });
    }

    if (viz_hint === "bar") {
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

    const chips = suggestFollowups({
      rows: storedResults as unknown[],
      domain: adapter.config.name,
      handleId: `qr_${queryRecord.id}`,
      ephemeral: false,
      memory: {
        context: {
          location: null,
          active_plan: plan,
          result_stack: [],
          active_filters: {},
        },
        profile: { user_attributes: {}, location_history: [] },
      },
    });

    const resultContext: ResultContext =
      storedResults.length === 0
        ? { status: "empty", followUps, confidence: "low" }
        : fallback
          ? { status: "fallback", fallback, followUps, confidence: "medium" }
          : { status: "exact", followUps, confidence: "high" };

    recordDomainCoOccurrence(sessionId, adapter.config.name).catch(() => {});

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
      chips,
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

// ── POST /chip — Phase C.11 ───────────────────────────────────────────────────
//
// Dispatches a chip action. Currently handles:
//   fetch_domain: cinema-showtimes  — scrape live showtimes for a named cinema
//
// Future actions (calculate_travel, overlay_spatial, etc.) will be added here
// as the connected query pipeline grows.

const ChipBodySchema = z.object({
  action: z.string(),
  args: z.object({
    domain: z.string().optional(),
    ref: z.string().optional(),
    cinemaName: z.string().optional(),
    cacheKey: z.string().optional(),
  }),
  sessionId: z.string().optional(),
});

queryRouter.post("/chip", async (req: Request, res: Response) => {
  const parsed = ChipBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "validation_error", details: parsed.error.errors });
  }

  const { action, args, sessionId } = parsed.data;

  // ── fetch_domain: cinema-showtimes ────────────────────────────────────────
  if (action === "fetch_domain" && args.domain === "cinema-showtimes") {
    const cinemaName = args.cinemaName;
    if (!cinemaName) {
      return res.status(400).json({ error: "missing_cinema_name" });
    }

    try {
      const { fetchShowtimes } = await import("./domains/cinemas-gb/showtimes");
      const { createEphemeralHandle, pushResultHandle } =
        await import("./conversation-memory");

      const cacheKey =
        args.cacheKey ?? cinemaName.toLowerCase().replace(/\s+/g, "-");
      const rows = await fetchShowtimes(cinemaName, cacheKey);
      const handle = createEphemeralHandle(rows, "cinema-showtimes");

      if (sessionId) {
        await pushResultHandle(sessionId, handle);
      }

      return res.json({
        type: "ephemeral",
        handle,
        rows,
        viz_hint: "table",
      });
    } catch (err: any) {
      return res
        .status(500)
        .json({ error: "chip_execution_error", message: err.message });
    }
  }

  // ── calculate_travel — D.12 ─────────────────────────────────────────────
  if (action === "calculate_travel") {
    const template = getWorkflowById("reachable-area");
    if (!template) {
      return res.status(404).json({ error: "workflow_not_found" });
    }
    return res.json({
      type: "workflow_input_required",
      workflow_id: template.id,
      workflow_name: template.name,
      input_schema: template.input_schema,
    });
  }
  // ── fetch_domain: hunting-day-plan — E.3 ─────────────────────────────────
  if (action === "fetch_domain" && args.domain === "hunting-day-plan") {
    const template = getWorkflowById("hunting-day-plan");
    if (!template) {
      return res.status(404).json({ error: "workflow_not_found" });
    }
    return res.json({
      type: "workflow_input_required",
      workflow_id: template.id,
      workflow_name: template.name,
      description: template.description,
      input_schema: template.input_schema,
    });
  }

  // ── Unhandled action ─────────────────────────────────────────────────────
  return res.status(400).json({
    error: "unsupported_chip_action",
    action,
    domain: args.domain ?? null,
    message: `Chip action '${action}' (domain: ${args.domain ?? "none"}) is not yet implemented.`,
  });
});

// ── POST /workflow — D.12 ─────────────────────────────────────────────────────

const WorkflowBodySchema = z.object({
  workflow_id: z.string().min(1),
  inputs: z.record(z.unknown()),
});

queryRouter.post("/workflow", async (req: Request, res: Response) => {
  const parsed = WorkflowBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "validation_error", details: parsed.error.errors });
  }

  const { workflow_id, inputs } = parsed.data;
  const template = getWorkflowById(workflow_id);

  if (!template) {
    return res.status(404).json({
      error: "workflow_not_found",
      message: `No workflow with id '${workflow_id}'`,
    });
  }

  try {
    const result = await executeWorkflow(template, inputs);
    return res.json({ type: "workflow_result", result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "workflow_execution_error", message });
  }
});

// ── GET /history ──────────────────────────────────────────────────────────────

queryRouter.get("/history", async (_req: Request, res: Response) => {
  const records = await prisma.query.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { rows_inserted: true, status: true, cache_hit: true },
      },
    },
  });

  const history = records.map((q) => ({
    query_id: q.id,
    text: q.text,
    category: q.category,
    date_from: q.date_from,
    date_to: q.date_to,
    poly: q.poly,
    resolved_location: q.resolved_location,
    country_code: q.country_code,
    domain: q.domain,
    intent: (q as any).intent ?? null,
    viz_hint: q.viz_hint,
    createdAt: q.createdAt,
    result_count: q.jobs[0]?.rows_inserted ?? null,
    cache_hit: q.jobs[0]?.cache_hit ?? false,
  }));

  return res.json(history);
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
