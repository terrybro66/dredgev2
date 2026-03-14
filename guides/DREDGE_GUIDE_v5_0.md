# DREDGE v5.0 — Conversational Confidence & Smart Empty States

## Overview

v5 is a single focused improvement: the app should never leave the user at a dead end. When a query returns no results, the system diagnoses why and offers specific, actionable alternatives. When a query is vague, the system makes its best attempt and surfaces follow-up chips derived from what it actually found.

Nothing in v4.1 is removed. All changes are additive.

---

## What Changes for the User

### Before (v4.1)
User asks: *"bicycle thefts in Cambridge"*
→ No results for current month (Police API lag)
→ App shows "No results found"
→ Dead end

### After (v5.0)
User asks: *"bicycle thefts in Cambridge"*
→ No results for current month
→ System detects API lag, retries with most recent available month
→ Returns results with a banner: *"No data for March 2026 — showing October 2025 instead"*
→ Follow-up chips: `See full year` · `Compare to nearby area` · `Break down by category`

---

## Core Concepts

### 1. Result Context

Every execute response now includes a `resultContext` object explaining what the system did, why it got what it got, and what the user can do next.

```ts
interface ResultContext {
  status: "exact" | "fallback" | "empty";
  reason?: string;           // human-readable explanation
  fallback?: FallbackInfo;   // what was changed to find results
  followUps: FollowUp[];     // suggested next queries
  confidence: "high" | "medium" | "low";
}

interface FallbackInfo {
  field: "date" | "location" | "category" | "radius";
  original: string;
  used: string;
  explanation: string;
}

interface FollowUp {
  label: string;             // chip label shown to user
  query: Partial<ExecuteBody>; // pre-formed query body
}
```

### 2. Retry Strategies

When a fetch returns zero results, the system tries recovery strategies in order before giving up:

| Strategy | Trigger | Action |
|---|---|---|
| Date fallback | Result empty + date is recent | Retry with latest available Police API month |
| Radius shrink | Result empty + location on force boundary | Retry with 2km radius instead of 5km |
| Category broaden | Result empty + specific category | Retry with `all-crime` |
| None worked | All retries empty | Return empty with diagnosis chips |

Only one fallback is applied per query — the first one that returns results wins. The fallback is disclosed to the user.

### 3. Follow-Up Chips

After any result (including fallbacks), the system generates 2–4 follow-up chips. These are not generic — they are derived from the data:

- If result spans one month → offer `See full year`
- If result count is high → offer `Show hotspot map` (already the default but surfaced explicitly)
- If result count is low → offer `Widen search area`
- If category is specific → offer `Compare all crime types`
- Always → offer `Different location`

Follow-ups are pre-formed `ExecuteBody` objects. Clicking a chip submits directly to `/execute` without going through `/parse` again.

### 4. Police API Date Availability

The Police API publishes available months at:
```
https://data.police.uk/api/crimes-street-dates
```

v5 fetches this list on startup and caches it in memory. The latest available month is used as the fallback date when a query targets a month not yet published.

---

## New Prisma Models

Add to `packages/database/prisma/schema.prisma`:

```prisma
model ApiAvailability {
  id          String   @id @default(cuid())
  source      String   // e.g. "police-uk"
  months      String[] // available month strings e.g. ["2025-10", "2025-09"]
  fetchedAt   DateTime @default(now())

  @@map("api_availability")
}
```

---

## New Schemas

Add to `packages/schemas/src/index.ts`:

```ts
// ── Follow-up chip ────────────────────────────────────────────────────────────

export const FollowUpSchema = z.object({
  label: z.string(),
  query: z.object({
    plan: QueryPlanSchema,
    poly: z.string(),
    viz_hint: VizHintSchema,
    resolved_location: z.string(),
    country_code: z.string(),
    intent: z.string(),
    months: z.array(z.string()),
  }),
});

export type FollowUp = z.infer<typeof FollowUpSchema>;

// ── Fallback info ─────────────────────────────────────────────────────────────

export const FallbackInfoSchema = z.object({
  field: z.enum(["date", "location", "category", "radius"]),
  original: z.string(),
  used: z.string(),
  explanation: z.string(),
});

export type FallbackInfo = z.infer<typeof FallbackInfoSchema>;

// ── Result context ────────────────────────────────────────────────────────────

export const ResultContextSchema = z.object({
  status: z.enum(["exact", "fallback", "empty"]),
  reason: z.string().optional(),
  fallback: FallbackInfoSchema.optional(),
  followUps: z.array(FollowUpSchema),
  confidence: z.enum(["high", "medium", "low"]),
});

export type ResultContext = z.infer<typeof ResultContextSchema>;
```

---

## New Files

### `apps/orchestrator/src/availability.ts`

Fetches and caches the Police API availability list. Called once on startup.

```ts
import axios from "axios";

const AVAILABILITY_URL = "https://data.police.uk/api/crimes-street-dates";

let cachedMonths: string[] = [];
let lastFetched: Date | null = null;

export async function loadAvailableMonths(): Promise<void> {
  try {
    const res = await axios.get(AVAILABILITY_URL);
    // response: [{ date: "2025-10", "stop-and-search": [...] }, ...]
    cachedMonths = res.data
      .map((entry: { date: string }) => entry.date)
      .sort()
      .reverse(); // most recent first
    lastFetched = new Date();
    console.log(`[availability] loaded ${cachedMonths.length} months, latest: ${cachedMonths[0]}`);
  } catch (err) {
    console.error("[availability] failed to load available months:", err);
    // non-fatal — fallback logic will degrade gracefully
  }
}

export function getLatestAvailableMonth(): string | null {
  return cachedMonths[0] ?? null;
}

export function isMonthAvailable(month: string): boolean {
  if (cachedMonths.length === 0) return true; // assume available if we don't know
  return cachedMonths.includes(month);
}

export function getAvailableMonths(): string[] {
  return cachedMonths;
}
```

### `apps/orchestrator/src/followups.ts`

Generates follow-up chips from a result. Pure function — no DB access.

```ts
import { FollowUp } from "@dredge/schemas";

interface FollowUpInput {
  plan: {
    category: string;
    date_from: string;
    date_to: string;
    location: string;
  };
  poly: string;
  viz_hint: string;
  resolved_location: string;
  country_code: string;
  intent: string;
  resultCount: number;
  usedMonth?: string; // set if a date fallback was applied
}

export function generateFollowUps(input: FollowUpInput): FollowUp[] {
  const chips: FollowUp[] = [];
  const { plan, poly, viz_hint, resolved_location, country_code, intent } = input;

  const baseQuery = { plan, poly, viz_hint: viz_hint as any, resolved_location, country_code, intent };

  // ── Date range expansion ──────────────────────────────────────────────────
  const isSingleMonth = plan.date_from === plan.date_to;
  if (isSingleMonth) {
    const [year, month] = plan.date_from.split("-").map(Number);
    const from = new Date(year, month - 7); // 6 months back
    const date_from = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`;
    chips.push({
      label: "See last 6 months",
      query: {
        ...baseQuery,
        plan: { ...plan, date_from, date_to: plan.date_to },
        months: [], // recalculated by execute
      },
    });
  }

  // ── Category broadening ───────────────────────────────────────────────────
  if (plan.category !== "all-crime") {
    chips.push({
      label: "All crime types",
      query: {
        ...baseQuery,
        plan: { ...plan, category: "all-crime" },
        months: [],
      },
    });
  }

  // ── Low result count — widen area ─────────────────────────────────────────
  // Note: radius widening is handled server-side in retry logic.
  // This chip re-runs with an explicit wider radius hint.
  if (input.resultCount < 10) {
    chips.push({
      label: "Widen search area",
      query: {
        ...baseQuery,
        plan: { ...plan },
        months: [],
      },
    });
  }

  return chips.slice(0, 4); // max 4 chips
}
```

### `apps/orchestrator/src/crime/retry.ts`

Retry strategies for empty results. Each strategy returns results or null.

```ts
import { fetchCrimes } from "./fetcher";
import { getLatestAvailableMonth, isMonthAvailable } from "../availability";
import { FallbackInfo } from "@dredge/schemas";

interface RetryResult {
  crimes: any[];
  fallback: FallbackInfo;
  months: string[];
}

// Strategy 1: date fallback — retry with latest available month
export async function retryWithLatestMonth(
  plan: any,
  poly: string,
  originalMonth: string,
): Promise<RetryResult | null> {
  const latest = getLatestAvailableMonth();
  if (!latest || latest === originalMonth) return null;
  if (isMonthAvailable(originalMonth)) return null; // month exists, just no data

  const fallbackPlan = { ...plan, date_from: latest, date_to: latest };
  const crimes = await fetchCrimes(fallbackPlan, poly);
  if (crimes.length === 0) return null;

  return {
    crimes,
    months: [latest],
    fallback: {
      field: "date",
      original: originalMonth,
      used: latest,
      explanation: `No data available for ${originalMonth}. The most recent available month is ${latest}.`,
    },
  };
}

// Strategy 2: radius shrink — retry with 2km instead of 5km
// Note: requires re-geocoding with a smaller radius. Pass the lat/lon directly.
export async function retryWithSmallerRadius(
  plan: any,
  lat: number,
  lon: number,
  prisma: any,
): Promise<RetryResult | null> {
  const { geocodeToPolygon } = await import("../geocoder");
  const geocoded = await geocodeToPolygon(plan.location, prisma, 2000);
  const crimes = await fetchCrimes(plan, geocoded.poly);
  if (crimes.length === 0) return null;

  return {
    crimes,
    months: [plan.date_from],
    fallback: {
      field: "radius",
      original: "5km",
      used: "2km",
      explanation: `${plan.location} is near a force boundary. Narrowed search radius to 2km.`,
    },
  };
}

// Strategy 3: category broadening — retry with all-crime
export async function retryWithAllCrime(
  plan: any,
  poly: string,
): Promise<RetryResult | null> {
  if (plan.category === "all-crime") return null;
  const broadPlan = { ...plan, category: "all-crime" };
  const crimes = await fetchCrimes(broadPlan, poly);
  if (crimes.length === 0) return null;

  return {
    crimes,
    months: [plan.date_from],
    fallback: {
      field: "category",
      original: plan.category,
      used: "all-crime",
      explanation: `No ${plan.category} recorded in this area. Showing all crime types instead.`,
    },
  };
}
```

---

## Modified Files

### `apps/orchestrator/src/index.ts`

Add `loadAvailableMonths()` call on startup:

```ts
import { loadDomains } from "./domains/registry";
import { loadAvailableMonths } from "./availability";

loadDomains();
loadAvailableMonths(); // ← add this line
```

### `apps/orchestrator/src/query.ts`

The execute endpoint gains retry logic and result context. Replace the live execution block (step 4) with the following. Everything before step 4 (adapter lookup, cache check, query record creation, job creation) is unchanged.

```ts
// ── inside the try block of step 4, after fetchCrimes ────────────────────────

const fetch_start = Date.now();
let crimes = await adapter.fetchData(plan, poly);
let fallback: FallbackInfo | undefined;
let effectiveMonths = months;

// ── retry strategies (only on empty result) ───────────────────────────────────
if (crimes.length === 0) {
  // Strategy 1: date fallback
  const dateRetry = await retryWithLatestMonth(plan, poly, plan.date_from);
  if (dateRetry) {
    crimes = dateRetry.crimes;
    fallback = dateRetry.fallback;
    effectiveMonths = dateRetry.months;
  }
}

if (crimes.length === 0) {
  // Strategy 2: radius shrink
  const radiusRetry = await retryWithSmallerRadius(plan, 0, 0, prisma);
  if (radiusRetry) {
    crimes = radiusRetry.crimes;
    fallback = radiusRetry.fallback;
    effectiveMonths = radiusRetry.months;
  }
}

if (crimes.length === 0) {
  // Strategy 3: category broadening
  const categoryRetry = await retryWithAllCrime(plan, poly);
  if (categoryRetry) {
    crimes = categoryRetry.crimes;
    fallback = categoryRetry.fallback;
    effectiveMonths = categoryRetry.months;
  }
}

const fetch_ms = Date.now() - fetch_start;

// ── store results ─────────────────────────────────────────────────────────────
const store_start = Date.now();
if (crimes.length > 0) {
  await evolveSchema(prisma, adapter.config.tableName, crimes[0], queryRecord.id, adapter.config.name);
  await storeResults(queryRecord.id, crimes, prisma);
}
const store_ms = Date.now() - store_start;

const storedResults = crimes.length > 0
  ? await (prisma as any)[adapter.config.prismaModel].findMany({
      where: { query_id: queryRecord.id },
      take: 100,
    })
  : [];

// ── generate result context ───────────────────────────────────────────────────
const followUps = generateFollowUps({
  plan,
  poly,
  viz_hint,
  resolved_location,
  country_code,
  intent,
  resultCount: storedResults.length,
});

const resultContext: ResultContext = {
  status: crimes.length === 0 ? "empty" : fallback ? "fallback" : "exact",
  reason: crimes.length === 0
    ? "No data found for this query after trying available recovery strategies."
    : undefined,
  fallback,
  followUps,
  confidence: crimes.length === 0 ? "low" : fallback ? "medium" : "high",
};

// ── cache + job update (unchanged from v4.1) ──────────────────────────────────
if (crimes.length > 0) {
  await prisma.queryCache.create({
    data: {
      query_hash,
      domain: adapter.config.name,
      result_count: storedResults.length,
      results: storedResults,
    },
  });
}

await prisma.queryJob.update({
  where: { id: job.id },
  data: {
    status: crimes.length === 0 ? "empty" : "complete",
    rows_inserted: storedResults.length,
    fetch_ms,
    store_ms,
    completedAt: new Date(),
  },
});

// ── response ──────────────────────────────────────────────────────────────────
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
  resultContext,
});
```

Add imports at the top of `query.ts`:

```ts
import { retryWithLatestMonth, retryWithSmallerRadius, retryWithAllCrime } from "./crime/retry";
import { generateFollowUps } from "./followups";
import { ResultContext, FallbackInfo } from "@dredge/schemas";
```

---

## Frontend Changes

### New types in `App.tsx`

```ts
interface FallbackInfo {
  field: "date" | "location" | "category" | "radius";
  original: string;
  used: string;
  explanation: string;
}

interface FollowUp {
  label: string;
  query: ExecuteBody;
}

interface ResultContext {
  status: "exact" | "fallback" | "empty";
  reason?: string;
  fallback?: FallbackInfo;
  followUps: FollowUp[];
  confidence: "high" | "medium" | "low";
}
```

Update `ExecuteResult` to include `resultContext`:

```ts
interface ExecuteResult {
  query_id: string;
  plan: QueryPlan;
  poly: string;
  viz_hint: VizHint;
  resolved_location: string;
  count: number;
  months_fetched: string[];
  results: CrimeResult[];
  cache_hit: boolean;
  resultContext: ResultContext;  // ← new
}
```

Also add `ExecuteBody` type (what gets sent to `/execute`):

```ts
interface ExecuteBody {
  plan: QueryPlan;
  poly: string;
  viz_hint: VizHint;
  resolved_location: string;
  country_code: string;
  intent: string;
  months: string[];
}
```

### New `FallbackBanner` component

Shown between the interpretation banner and the results when `status === "fallback"`:

```tsx
function FallbackBanner({ fallback }: { fallback: FallbackInfo }) {
  return (
    <div style={{
      padding: "8px 16px",
      background: "rgba(245, 166, 35, 0.08)",
      border: "1px solid var(--amber-dim)",
      borderLeft: "3px solid var(--amber)",
      fontSize: "12px",
      color: "var(--text-mid)",
    }}>
      <span style={{ color: "var(--amber)", marginRight: 8 }}>⚠</span>
      {fallback.explanation}
    </div>
  );
}
```

### New `FollowUpChips` component

Shown below results when `followUps.length > 0`:

```tsx
function FollowUpChips({
  followUps,
  onSelect,
}: {
  followUps: FollowUp[];
  onSelect: (query: ExecuteBody) => void;
}) {
  if (followUps.length === 0) return null;
  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      padding: "12px 0",
      borderTop: "1px solid var(--border)",
    }}>
      <span style={{ fontSize: "11px", color: "var(--text-dim)", alignSelf: "center" }}>
        Explore →
      </span>
      {followUps.map((f) => (
        <button
          key={f.label}
          className="example-chip"
          onClick={() => onSelect(f.query)}
          style={{ color: "var(--amber)", borderColor: "var(--amber-dim)" }}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
```

### Updated `EmptyResults` component

Replace the existing `EmptyResults` with a version that shows follow-up chips:

```tsx
function EmptyResults({
  plan,
  resultContext,
  onFollowUp,
  onRefine,
}: {
  plan: QueryPlan;
  resultContext: ResultContext;
  onFollowUp: (query: ExecuteBody) => void;
  onRefine: () => void;
}) {
  return (
    <div className="empty-panel">
      <div className="empty-icon">○</div>
      <div className="empty-title">No results found</div>
      <p className="empty-message">
        No {formatCategory(plan.category).toLowerCase()} were recorded in this
        area for{" "}
        {plan.date_from === plan.date_to
          ? formatMonth(plan.date_from)
          : `${formatMonth(plan.date_from)} – ${formatMonth(plan.date_to)}`}.
      </p>
      {resultContext.reason && (
        <p className="empty-hint">{resultContext.reason}</p>
      )}
      <FollowUpChips followUps={resultContext.followUps} onSelect={onFollowUp} />
      <button className="btn-ghost" onClick={onRefine}>
        Refine query
      </button>
    </div>
  );
}
```

### Updated `App` component — execute via chip

Add a `handleFollowUp` function that submits a pre-formed query directly to `/execute`, bypassing `/parse`:

```ts
const handleFollowUp = async (query: ExecuteBody) => {
  setStage("loading");
  setLoadingStage("fetching");
  setResult(null);

  try {
    const res = await fetch(`${API}/query/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });
    const data = await res.json();
    if (!res.ok) {
      setIntentError({
        error: "execute_error",
        understood: {},
        missing: [],
        message: data.message ?? "Execution failed.",
      });
      setStage("error");
      return;
    }
    // Update parsed to reflect the follow-up query's plan
    setParsed({
      plan: query.plan,
      poly: query.poly,
      viz_hint: query.viz_hint,
      resolved_location: query.resolved_location,
      country_code: query.country_code,
      intent: query.intent,
      months: query.months,
    });
    setResult(data);
    setStage("done");
  } catch {
    setIntentError({
      error: "network_error",
      understood: {},
      missing: [],
      message: "Lost connection during data fetch.",
    });
    setStage("error");
  }
  setLoadingStage(null);
};
```

Update the render section to pass `handleFollowUp` to `ResultRenderer` and `EmptyResults`, and render `FallbackBanner` when appropriate:

```tsx
{stage === "done" && parsed && (
  <InterpretationBanner
    parsed={parsed}
    onRefine={handleRefine}
    cacheHit={result?.cache_hit ?? false}
  />
)}

{stage === "done" && result?.resultContext?.fallback && (
  <FallbackBanner fallback={result.resultContext.fallback} />
)}

{stage === "done" && result && result.count > 0 && (
  <ResultRenderer result={result} onRefine={handleRefine} />
)}

{stage === "done" && result && result.count === 0 && parsed && (
  <EmptyResults
    plan={parsed.plan}
    resultContext={result.resultContext}
    onFollowUp={handleFollowUp}
    onRefine={handleRefine}
  />
)}

{stage === "done" && result && result.resultContext?.followUps?.length > 0 && result.count > 0 && (
  <FollowUpChips
    followUps={result.resultContext.followUps}
    onSelect={handleFollowUp}
  />
)}
```

---

## Branch Plan

Branches must be done in order 1 → 2 → 3. Branches 4 and 5 can be done in any order after 3 is merged.

```
feat/schemas-v5       ← 1. New schemas (FollowUp, FallbackInfo, ResultContext)
feat/database-v5      ← 2. ApiAvailability model + migration
feat/availability     ← 3. availability.ts + loadAvailableMonths in index.ts
feat/retry-strategies ← 4. retry.ts + followups.ts + query.ts updates
feat/frontend-v5      ← 5. FallbackBanner, FollowUpChips, EmptyResults, handleFollowUp
```

### Commit messages

```
feat: schemas — FollowUp, FallbackInfo, ResultContext types
feat: database — ApiAvailability model
feat: availability — load and cache Police API date availability on startup
feat: retry — empty result recovery strategies + follow-up chip generation
feat: frontend — fallback banner, follow-up chips, empty state with suggestions
```

---

## Testing Checklist

### Manual tests (run the app)

| Query | Expected behaviour |
|---|---|
| `bicycle theft in Cambridge` (no date) | Detects API lag, falls back to latest available month, shows fallback banner |
| `burglaries in Cambridge in January 2024` | Exact match, no banner, chips shown below |
| `crime in Romford` | Detects boundary issue, retries with 2km radius |
| `unicycle theft in Cambridge` | Category not found, broadens to all-crime, shows banner |
| Same query twice | Second run returns from cache instantly, shows `cached` badge |

### Unit tests to write

`apps/orchestrator/src/__tests__/availability.test.ts`
- `loadAvailableMonths` populates the cache from API response
- `getLatestAvailableMonth` returns most recent month
- `isMonthAvailable` returns true/false correctly
- Handles network failure gracefully (does not throw)

`apps/orchestrator/src/__tests__/retry.test.ts`
- `retryWithLatestMonth` returns null when month is already available
- `retryWithLatestMonth` returns fallback result when month is unavailable
- `retryWithAllCrime` returns null when category is already all-crime
- `retryWithAllCrime` returns broadened results when specific category is empty
- `retryWithSmallerRadius` calls geocoder with 2000m radius

`apps/orchestrator/src/__tests__/followups.test.ts`
- Single month result → includes "See last 6 months" chip
- Specific category → includes "All crime types" chip
- Low result count → includes "Widen search area" chip
- Returns maximum 4 chips

---

## Notes

**Retry order matters.** Date fallback is tried first because it is the most common cause of empty results (API lag). Radius shrink is second because boundary clipping is the next most common. Category broadening is last because it changes the meaning of the query most significantly — it should only kick in when the other strategies have failed.

**Only one fallback is disclosed.** If the date fallback succeeds, the radius and category strategies are not attempted. The user sees one clear explanation, not a chain of retries.

**Follow-ups bypass `/parse`.** Chips submit directly to `/execute` with a pre-formed body. This avoids a round-trip through the LLM and ensures the chip does exactly what it says. The tradeoff is that chips must carry the full `ExecuteBody` — the `generateFollowUps` function is responsible for constructing valid bodies.

**`ApiAvailability` is in the DB but primarily used from memory.** `loadAvailableMonths` writes to memory on startup. The DB model exists so availability data survives restarts and can be inspected in Prisma Studio. A future version could refresh it on a schedule.
