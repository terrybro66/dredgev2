import { Router, Request, Response } from "express";
import { z } from "zod";
import { QueryPlanSchema, VizHintSchema } from "@dredge/schemas";
import { prisma } from "./db";
import { geocodeToPolygon } from "./geocoder";
import { evolveSchema } from "./schema";
import { parseIntent, deriveVizHint, expandDateRange } from "./crime/intent";
import { fetchCrimes } from "./crime/fetcher";
import { storeResults } from "./crime/store";

export const queryRouter = Router();

const ParseBodySchema = z.object({ text: z.string().min(1) });

const ExecuteBodySchema = z.object({
  plan: QueryPlanSchema,
  poly: z.string(),
  viz_hint: VizHintSchema,
  resolved_location: z.string(),
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

  return res.json({
    plan,
    poly: geocoded.poly,
    viz_hint,
    resolved_location: geocoded.display_name,
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

  const { plan, poly, viz_hint, resolved_location } = bodyResult.data;

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
        domain: "crime",
        resolved_location,
      },
    });
  } catch (err: any) {
    console.error("[execute] prisma.query.create failed:", err);
    return res.status(500).json({ error: "db_error", message: err.message });
  }

  let crimes: any[];
  try {
    crimes = await fetchCrimes(plan, poly);
  } catch (err: any) {
    console.error("[execute] fetchCrimes failed:", {
      plan,
      poly,
      error: err.message,
    });
    return res.status(500).json({ error: "fetch_error", message: err.message });
  }

  if (crimes.length > 0) {
    try {
      await evolveSchema(
        prisma,
        "crime_results",
        crimes[0],
        queryRecord.id,
        "crime",
      );
    } catch (err: any) {
      console.error("[execute] evolveSchema failed:", err);
      return res
        .status(500)
        .json({ error: "schema_error", message: err.message });
    }
  }

  try {
    await storeResults(queryRecord.id, crimes, prisma);
  } catch (err: any) {
    console.error("[execute] storeResults failed:", err);
    return res.status(500).json({ error: "store_error", message: err.message });
  }

  // fetch stored rows so the frontend gets flattened, typed fields
  let storedResults;
  try {
    storedResults = await (prisma as any).crimeResult.findMany({
      where: { query_id: queryRecord.id },
      take: 100,
    });
  } catch (err: any) {
    console.error("[execute] crimeResult.findMany failed:", err);
    return res.status(500).json({ error: "db_error", message: err.message });
  }

  const months_fetched = expandDateRange(plan.date_from, plan.date_to);

  return res.json({
    query_id: queryRecord.id,
    plan,
    poly,
    viz_hint,
    resolved_location,
    count: crimes.length,
    months_fetched,
    results: storedResults,
  });
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
