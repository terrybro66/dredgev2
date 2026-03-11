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

// ── POST /parse ───────────────────────────────────────────────────────────────

// TODO: validate req.body with Zod — return 400 with Zod error details on failure
// TODO: call parseIntent(text) — on IntentError return 400 with full structured error payload:
//   { error: "incomplete_intent", understood: {...}, missing: [...], message: "..." }
// TODO: call geocodeToPolygon(plan.location) — on geocode failure return 400 with structured error
// TODO: derive viz_hint from deriveVizHint(plan, text)
// TODO: return confirmation payload — do NOT write to database:
//   { plan, poly, viz_hint, resolved_location, months }

queryRouter.post("/parse", async (req: Request, res: Response) => {
  res.status(501).json({ error: "TODO: implement POST /query/parse" });
});

// ── POST /execute ─────────────────────────────────────────────────────────────

// TODO: validate req.body against execute schema { plan, poly, viz_hint, resolved_location }
// TODO: create Query record in postgres with domain: "crime"
// TODO: call fetchCrimes(plan, poly) — expands date range, fetches all months sequentially
// TODO: if crimes returned → evolveSchema(prisma, "crime_results", sampleRow, queryRecord.id, "crime")
// TODO: do NOT call evolveSchema if crimes array is empty
// TODO: call storeResults(queryRecord.id, crimes, prisma)
// TODO: validate outbound response with Zod before sending
// TODO: return { query_id, plan, poly, viz_hint, resolved_location, count, months_fetched, results }
// TODO: cap results at 100

queryRouter.post("/execute", async (req: Request, res: Response) => {
  res.status(501).json({ error: "TODO: implement POST /query/execute" });
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

// TODO: prisma.query.findUnique with include: { results: true }
// TODO: return 404 if not found

queryRouter.get("/:id", async (req: Request, res: Response) => {
  res.status(501).json({ error: "TODO: implement GET /query/:id" });
});
