import crypto from "crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { QueryPlanSchema } from "@dredge/schemas";
import { prisma } from "./db";
import { geocodeToPolygon } from "./geocoder";
import { evolveSchema } from "./schema";
import { parseIntent, deriveVizHint, expandDateRange } from "./crime/intent";
import { fetchCrimes } from "./crime/fetcher";
import { storeResults } from "./crime/store";
import { getDomainForQuery } from "./domains/registry";

export const queryRouter = Router();

const ParseBodySchema = z.object({ text: z.string().min(1) });

const ExecuteBodySchema = z.object({
  plan: QueryPlanSchema,
  poly: z.string(),
  viz_hint: z.enum(["map", "bar", "table"]),
  resolved_location: z.string(),
  country_code: z.string(),
  intent: z.string(),
  months: z.array(z.string()),
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
    console.error("[parse] parseIntent failed:", err);
    return res.status(400).json(err);
  }

  let geocoded;
  try {
    geocoded = await geocodeToPolygon(plan.location, prisma);
  } catch (err: any) {
    console.error("[parse] geocodeToPolygon failed:", err);
    return res.status(400).json(err);
  }

  const viz_hint = deriveVizHint(plan, text);
  const months = expandDateRange(plan.date_from, plan.date_to);
  const intent = "crime"; // hardcoded for now; extensible when further domains are added

  return res.json({
    plan,
    poly: geocoded.poly,
    viz_hint,
    resolved_location: geocoded.display_name,
    country_code: geocoded.country_code, // ← from geocoder result
    intent, // ← new
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
  } = bodyResult.data;

  // 1. Resolve adapter via intent + country routing
  const adapter = getDomainForQuery(country_code, intent);
  if (!adapter) {
    return res.status(400).json({
      error: "unsupported_region",
      message: `No data source available for country: ${country_code} / intent: ${intent}`,
      country_code,
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

  // 3. Cache check — return immediately on hit
  const cached = await prisma.queryCache.findUnique({ where: { query_hash } });
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
    const crimes = await fetchCrimes(plan, poly);
    const fetch_ms = Date.now() - fetch_start;

    const store_start = Date.now();
    if (crimes.length > 0) {
      await evolveSchema(
        prisma,
        adapter.config.tableName,
        crimes[0],
        queryRecord.id,
        adapter.config.name,
      );
    }
    await storeResults(queryRecord.id, crimes, prisma);
    const store_ms = Date.now() - store_start;

    const storedResults = await (prisma as any)[
      adapter.config.prismaModel
    ].findMany({
      where: { query_id: queryRecord.id },
      take: 100,
    });

    await prisma.queryCache.create({
      data: {
        query_hash,
        domain: adapter.config.name,
        result_count: storedResults.length,
        results: storedResults,
      },
    });

    await prisma.queryJob.update({
      where: { id: job.id },
      data: {
        status: "complete",
        rows_inserted: storedResults.length,
        fetch_ms,
        store_ms,
        completedAt: new Date(),
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
      }),
    );

    return res.json({
      query_id: queryRecord.id,
      plan,
      poly,
      viz_hint,
      resolved_location,
      count: storedResults.length,
      months_fetched: months,
      results: storedResults,
      cache_hit: false,
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
