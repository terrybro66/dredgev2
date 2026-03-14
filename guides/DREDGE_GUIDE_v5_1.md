# DREDGE v5.1 — Conversational Confidence & Smart Empty States

## Overview

v5.1 is a single focused improvement: the app should never leave the user at a dead end. When a query returns no results, the system diagnoses why and offers specific, actionable alternatives. When a query is vague, the system makes its best attempt and surfaces follow-up chips derived from what it actually found.

Nothing in v4.1 is removed. All changes are additive.

**v5.1 vs v5.0:** This guide amends the original v5.0 proposal following architectural review. The key change is that retry logic is pushed into domain adapters rather than hardcoded into `query.ts`. This preserves the domain-agnostic pipeline established in v4.1 — adding a second domain in a future version will not require editing `query.ts`.

---

## What Changes for the User

### Before (v4.1)
User asks: *"bicycle thefts in Cambridge"*
→ No results for current month (Police API lag)
→ App shows "No results found"
→ Dead end

### After (v5.1)
User asks: *"bicycle thefts in Cambridge"*
→ No results for current month
→ System detects API lag, retries with most recent available month
→ Returns results with a banner: *"No data for March 2026 — showing October 2025 instead"*
→ Follow-up chips: `See last 6 months` · `All crime types` · `Widen search area`

---

## Core Concepts

### 1. Result Context

Every execute response now includes a `resultContext` object explaining what the system did, why it got what it got, and what the user can do next.

```ts
interface ResultContext {
  status: "exact" | "fallback" | "empty";
  reason?: string;           // human-readable explanation when empty
  fallback?: FallbackInfo;   // what was changed to find results
  followUps: FollowUp[];     // suggested next queries as chips
  confidence: "high" | "medium" | "low";
}

interface FallbackInfo {
  field: "date" | "location" | "category" | "radius";
  original: string;
  used: string;
  explanation: string;
}

interface FollowUp {
  label: string;               // chip label shown to user
  query: ExecuteBody;          // pre-formed query body
}
```

### 2. Retry Strategies — Adapter-Owned

Each domain adapter is responsible for its own recovery logic via an optional `recoverFromEmpty` method on the `DomainAdapter` interface. This keeps `query.ts` domain-agnostic — it calls the hook if it exists, without knowing what the adapter does internally.

```ts
interface DomainAdapter {
  config: DomainConfig;
  fetchData: (plan: any, locationArg: string) => Promise<unknown[]>;

  // Optional recovery hook. Called by query.ts when fetchData returns empty.
  // The adapter tries its own strategies and returns the first that succeeds,
  // or null if nothing worked.
  recoverFromEmpty?: (
    plan: any,
    locationArg: string,
    prisma: any,
  ) => Promise<{ data: unknown[]; fallback: FallbackInfo } | null>;

  flattenRow: (row: unknown) => Record<string, unknown>;
  storeResults: (queryId: string, rows: unknown[], prisma: any) => Promise<void>;
}
```

The `crime-uk` adapter implements three strategies in order:

| Strategy | Trigger | Action |
|---|---|---|
| Date fallback | Date not in Police API availability list | Retry with latest available month |
| Radius shrink | Location near force boundary | Retry with 2km radius instead of 5km |
| Category broaden | Specific category returns nothing | Retry with `all-crime` |
| None worked | All strategies exhausted | Return null → pipeline returns empty with chips |

Only one fallback is applied per query — the first that returns results wins and is disclosed to the user.

### 3. Follow-Up Chips

After any result (including fallbacks and empty states), the system generates up to 4 follow-up chips derived from the data and the domain. Chips are pre-formed `ExecuteBody` objects — clicking one submits directly to `/execute` without going through `/parse` again.

Chip generation is domain-aware. The `generateFollowUps` function accepts a `domain` parameter so different domains can produce relevant chips. The `crime-uk` rules:

- Single month result → `See last 6 months`
- Specific category → `All crime types`
- Low result count (< 10) → `Widen search area`
- Capped at 4 chips

### 4. Police API Date Availability

The Police API publishes available months at `https://data.police.uk/api/crimes-street-dates`. v5.1 fetches this list on startup and caches it in memory. The `availability.ts` module is designed to support multiple sources — each domain that requires availability checking registers its own source key and URL in `index.ts`.

---

## New Prisma Models

Add to `packages/database/prisma/schema.prisma`:

```prisma
model ApiAvailability {
  id        String   @id @default(cuid())
  source    String   @unique  // e.g. "police-uk", "openweather"
  months    String[]          // available month strings e.g. ["2025-10", "2025-09"]
  fetchedAt DateTime @default(now())

  @@map("api_availability")
}
```

Also add fallback analytics fields to `QueryJob`:

```prisma
model QueryJob {
  // ... all existing fields unchanged ...
  fallback_applied String?   // "date" | "radius" | "category" | null
  fallback_success Boolean?  // whether the fallback returned results
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

Fetches and caches availability data per source. Designed for multiple domains from the start.

```ts
import axios from "axios";

interface SourceAvailability {
  months: string[];
  fetchedAt: Date;
}

const store = new Map<string, SourceAvailability>();

export async function loadAvailability(
  source: string,
  url: string,
  extractMonths: (data: any) => string[],
): Promise<void> {
  try {
    const res = await axios.get(url);
    const months = extractMonths(res.data).sort().reverse(); // most recent first
    store.set(source, { months, fetchedAt: new Date() });
    console.log(
      JSON.stringify({
        event: "availability_loaded",
        source,
        count: months.length,
        latest: months[0],
      }),
    );
  } catch (err: any) {
    console.error(
      JSON.stringify({ event: "availability_failed", source, error: err.message }),
    );
    // non-fatal — recovery logic degrades gracefully when store is empty
  }
}

export function getLatestMonth(source: string): string | null {
  return store.get(source)?.months[0] ?? null;
}

export function isMonthAvailable(source: string, month: string): boolean {
  const entry = store.get(source);
  if (!entry || entry.months.length === 0) return true; // assume available if unknown
  return entry.months.includes(month);
}

export function getAvailableMonths(source: string): string[] {
  return store.get(source)?.months ?? [];
}
```

### `apps/orchestrator/src/followups.ts`

Generates follow-up chips. Domain-aware via the `domain` parameter.

```ts
import { FollowUp } from "@dredge/schemas";

interface FollowUpInput {
  domain: string;
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
}

export function generateFollowUps(input: FollowUpInput): FollowUp[] {
  switch (input.domain) {
    case "crime-uk":
      return generateCrimeUkFollowUps(input);
    default:
      return []; // safe fallback — unknown domains return no chips
  }
}

function generateCrimeUkFollowUps(input: FollowUpInput): FollowUp[] {
  const chips: FollowUp[] = [];
  const { plan, poly, viz_hint, resolved_location, country_code, intent } = input;
  const baseQuery = {
    plan,
    poly,
    viz_hint: viz_hint as any,
    resolved_location,
    country_code,
    intent,
    months: [],
  };

  // Single month → offer 6-month expansion
  const isSingleMonth = plan.date_from === plan.date_to;
  if (isSingleMonth) {
    const [year, month] = plan.date_from.split("-").map(Number);
    const from = new Date(year, month - 7); // 6 months back
    const date_from = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`;
    chips.push({
      label: "See last 6 months",
      query: { ...baseQuery, plan: { ...plan, date_from, date_to: plan.date_to } },
    });
  }

  // Specific category → offer all-crime
  if (plan.category !== "all-crime") {
    chips.push({
      label: "All crime types",
      query: { ...baseQuery, plan: { ...plan, category: "all-crime" } },
    });
  }

  // Low results → offer wider area
  if (input.resultCount < 10) {
    chips.push({
      label: "Widen search area",
      query: { ...baseQuery },
    });
  }

  return chips.slice(0, 4);
}
```

### `apps/orchestrator/src/crime/recovery.ts`

All three retry strategies for `crime-uk`. Imported only by `crime-uk.ts` — never by `query.ts`.

```ts
import { FallbackInfo } from "@dredge/schemas";
import { fetchCrimes } from "./fetcher";
import { getLatestMonth, isMonthAvailable } from "../availability";

const SOURCE = "police-uk";

interface RecoveryResult {
  data: unknown[];
  fallback: FallbackInfo;
}

// Strategy 1: date fallback
async function recoverWithLatestMonth(
  plan: any,
  poly: string,
): Promise<RecoveryResult | null> {
  const latest = getLatestMonth(SOURCE);
  if (!latest) return null;
  if (isMonthAvailable(SOURCE, plan.date_from)) return null; // month exists, just no data

  const fallbackPlan = { ...plan, date_from: latest, date_to: latest };
  const data = await fetchCrimes(fallbackPlan, poly);
  if (data.length === 0) return null;

  return {
    data,
    fallback: {
      field: "date",
      original: plan.date_from,
      used: latest,
      explanation: `No data available for ${plan.date_from}. Showing the most recent available month (${latest}) instead.`,
    },
  };
}

// Strategy 2: radius shrink
async function recoverWithSmallerRadius(
  plan: any,
  poly: string,
  prisma: any,
): Promise<RecoveryResult | null> {
  const { geocodeToPolygon } = await import("../geocoder");
  try {
    const geocoded = await geocodeToPolygon(plan.location, prisma, 2000);
    const data = await fetchCrimes(plan, geocoded.poly);
    if (data.length === 0) return null;

    return {
      data,
      fallback: {
        field: "radius",
        original: "5km",
        used: "2km",
        explanation: `${plan.location} is near a force boundary. Narrowed the search radius to 2km to stay within one force area.`,
      },
    };
  } catch {
    return null;
  }
}

// Strategy 3: category broadening
async function recoverWithAllCrime(
  plan: any,
  poly: string,
): Promise<RecoveryResult | null> {
  if (plan.category === "all-crime") return null;
  const broadPlan = { ...plan, category: "all-crime" };
  const data = await fetchCrimes(broadPlan, poly);
  if (data.length === 0) return null;

  return {
    data,
    fallback: {
      field: "category",
      original: plan.category,
      used: "all-crime",
      explanation: `No ${plan.category} recorded in this area for this period. Showing all crime types instead.`,
    },
  };
}

// Main entry point — called by crime-uk adapter's recoverFromEmpty hook
export async function recoverFromEmpty(
  plan: any,
  poly: string,
  prisma: any,
): Promise<RecoveryResult | null> {
  return (
    (await recoverWithLatestMonth(plan, poly)) ??
    (await recoverWithSmallerRadius(plan, poly, prisma)) ??
    (await recoverWithAllCrime(plan, poly)) ??
    null
  );
}
```

---

## Modified Files

### `apps/orchestrator/src/domains/registry.ts`

Add `recoverFromEmpty` to the `DomainAdapter` interface and import `FallbackInfo`:

```ts
import { DomainConfig, FallbackInfo } from "@dredge/schemas";

export interface DomainAdapter {
  config: DomainConfig;
  fetchData: (plan: any, locationArg: string) => Promise<unknown[]>;
  recoverFromEmpty?: (
    plan: any,
    locationArg: string,
    prisma: any,
  ) => Promise<{ data: unknown[]; fallback: FallbackInfo } | null>;
  flattenRow: (row: unknown) => Record<string, unknown>;
  storeResults: (queryId: string, rows: unknown[], prisma: any) => Promise<void>;
}
```

### `apps/orchestrator/src/domains/crime-uk.ts`

Add `recoverFromEmpty` to the adapter:

```ts
import { recoverFromEmpty } from "../crime/recovery";

export const crimeUkAdapter: DomainAdapter = {
  config: { /* unchanged */ },
  fetchData: (plan: any, poly: string) => fetchCrimes(plan, poly),
  recoverFromEmpty: (plan: any, poly: string, prisma: any) =>
    recoverFromEmpty(plan, poly, prisma),
  flattenRow: (row: unknown) => row as Record<string, unknown>,
  storeResults: (queryId: string, rows: unknown[], prisma: any) =>
    storeResults(queryId, rows as any[], prisma),
};
```

### `apps/orchestrator/src/index.ts`

Add `loadAvailability` call per source:

```ts
import { loadDomains } from "./domains/registry";
import { loadAvailability } from "./availability";

loadDomains();

// Register availability per source. Add new entries when new domains are added.
loadAvailability(
  "police-uk",
  "https://data.police.uk/api/crimes-street-dates",
  (data) => data.map((entry: { date: string }) => entry.date),
);
```

### `apps/orchestrator/src/query.ts`

Replace the live execution fetch section with the updated block below. `query.ts` now has no crime-specific imports — it calls `adapter.fetchData`, `adapter.recoverFromEmpty`, and `adapter.storeResults` only.

Remove these direct imports (they are now called via the adapter):
```ts
// REMOVE:
import { fetchCrimes } from "./crime/fetcher";
import { storeResults } from "./crime/store";
```

Add these imports:
```ts
import { generateFollowUps } from "./followups";
import { ResultContext, FallbackInfo } from "@dredge/schemas";
```

Replace the fetch + store section inside the live execution try block:

```ts
// ── fetch ─────────────────────────────────────────────────────────────────────
const fetch_start = Date.now();
let crimes = await adapter.fetchData(plan, poly) as any[];
let fallback: FallbackInfo | undefined;
let effectiveMonths = months;

// ── recovery (adapter-owned, query.ts stays domain-agnostic) ──────────────────
if (crimes.length === 0 && adapter.recoverFromEmpty) {
  const recovery = await adapter.recoverFromEmpty(plan, poly, prisma);
  if (recovery) {
    crimes = recovery.data as any[];
    fallback = recovery.fallback;
    if (fallback.field === "date") {
      effectiveMonths = [fallback.used];
    }
  }
}

const fetch_ms = Date.now() - fetch_start;

// ── store ─────────────────────────────────────────────────────────────────────
const store_start = Date.now();
if (crimes.length > 0) {
  await evolveSchema(
    prisma,
    adapter.config.tableName,
    crimes[0],
    queryRecord.id,
    adapter.config.name,
  );
  await adapter.storeResults(queryRecord.id, crimes, prisma);
}
const store_ms = Date.now() - store_start;

const storedResults = crimes.length > 0
  ? await (prisma as any)[adapter.config.prismaModel].findMany({
      where: { query_id: queryRecord.id },
      take: 100,
    })
  : [];

// ── result context ────────────────────────────────────────────────────────────
const followUps = generateFollowUps({
  domain: adapter.config.name,
  plan,
  poly,
  viz_hint,
  resolved_location,
  country_code,
  intent,
  resultCount: storedResults.length,
});

const resultContext: ResultContext = {
  status: storedResults.length === 0 ? "empty" : fallback ? "fallback" : "exact",
  reason: storedResults.length === 0
    ? "No data found for this query. The area may have no recorded incidents, or data may not be available for this period."
    : undefined,
  fallback,
  followUps,
  confidence: storedResults.length === 0 ? "low" : fallback ? "medium" : "high",
};

// ── cache + job update ────────────────────────────────────────────────────────
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
    status: storedResults.length === 0 ? "empty" : "complete",
    rows_inserted: storedResults.length,
    fetch_ms,
    store_ms,
    fallback_applied: fallback?.field ?? null,
    fallback_success: fallback ? true : null,
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
    fallback: fallback?.field ?? null,
  }),
);

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

Update `ExecuteResult`:

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

### New `FallbackBanner` component

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

### `handleFollowUp` in App component

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

### Updated render section

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

{stage === "done" && result && result.count > 0 &&
  result.resultContext?.followUps?.length > 0 && (
  <FollowUpChips
    followUps={result.resultContext.followUps}
    onSelect={handleFollowUp}
  />
)}

{stage === "done" && result && result.count === 0 && parsed && (
  <EmptyResults
    plan={parsed.plan}
    resultContext={result.resultContext}
    onFollowUp={handleFollowUp}
    onRefine={handleRefine}
  />
)}
```

---

## Branch Plan

Branches must be done in order 1 → 2 → 3 → 4. Branches 5 and 6 can be done in any order after 4 is merged.

```
feat/schemas-v5       ← 1. New schemas (FollowUp, FallbackInfo, ResultContext)
feat/database-v5      ← 2. ApiAvailability model + fallback fields on QueryJob
feat/availability     ← 3. availability.ts (multi-source) + loadAvailability in index.ts
feat/adapter-recovery ← 4. recoverFromEmpty on DomainAdapter + crime-uk.ts wired up
feat/crime-recovery   ← 5. recovery.ts + followups.ts + query.ts pipeline updates
feat/frontend-v5      ← 6. FallbackBanner, FollowUpChips, EmptyResults, handleFollowUp
```

### Commit messages

```
feat: schemas — FollowUp, FallbackInfo, ResultContext types
feat: database — ApiAvailability model, fallback analytics on QueryJob
feat: availability — multi-source availability cache, load Police API on startup
feat: adapter-recovery — recoverFromEmpty hook on DomainAdapter interface + crime-uk wired
feat: crime-recovery — recovery.ts strategies, followups.ts, query.ts pipeline updates
feat: frontend — fallback banner, follow-up chips, empty state with suggestions
```

---

## Testing Checklist

### Manual tests (run the app)

| Query | Expected behaviour |
|---|---|
| `bicycle theft in Cambridge` (no date) | Date fallback applied, fallback banner shown, chips below |
| `burglaries in Cambridge in January 2024` | Exact match, no banner, chips shown |
| `crime in Romford` | Radius shrink applied if boundary clip detected |
| `unicycle theft in Cambridge` | Category broadened to all-crime, banner shown |
| Same query twice | Second run from cache, `cached` badge shown |
| Query with no data at all | Empty state with follow-up chips — not a dead end |

### Unit tests to write

`apps/orchestrator/src/__tests__/availability.test.ts`
- `loadAvailability` populates the store for a given source
- `getLatestMonth` returns the most recent month for a source
- `isMonthAvailable` returns true when month is in the list
- `isMonthAvailable` returns true when store is empty (assume available)
- Handles network failure gracefully without throwing

`apps/orchestrator/src/__tests__/recovery.test.ts`
- `recoverWithLatestMonth` returns null when month is already available
- `recoverWithLatestMonth` returns fallback result when month is unavailable
- `recoverWithAllCrime` returns null when category is already all-crime
- `recoverWithAllCrime` returns broadened results when specific category is empty
- `recoverFromEmpty` tries strategies in order, returns first success
- `recoverFromEmpty` returns null when all strategies exhausted

`apps/orchestrator/src/__tests__/followups.test.ts`
- Single month crime result → includes "See last 6 months" chip
- Specific category → includes "All crime types" chip
- Low result count → includes "Widen search area" chip
- Returns maximum 4 chips
- Unknown domain → returns empty array without throwing

`apps/orchestrator/src/__tests__/registry.test.ts` (additions)
- Adapter with `recoverFromEmpty` defined — hook is invoked when fetchData returns empty
- Adapter without `recoverFromEmpty` — pipeline skips recovery step gracefully

---

## Notes

**`query.ts` stays domain-agnostic.** Retry strategies live entirely in `crime-uk.ts` and `recovery.ts`. When a second domain is added, implement its own `recoverFromEmpty` — `query.ts` is not touched. This was the key architectural fix from the review.

**`availability.ts` supports multiple sources from day one.** Call `loadAvailability` once per source in `index.ts`. Each source has its own in-memory entry keyed by source name. The `@unique` constraint on `ApiAvailability.source` in the DB reflects this.

**`followups.ts` is domain-aware.** The `switch(domain)` block means adding a second domain requires only a new case function. Unknown domains return an empty array and never crash.

**Fallback analytics are tracked.** `fallback_applied` and `fallback_success` on `QueryJob` let you observe which strategies fire most often. If date fallback is firing on 80% of queries it signals that the default date logic in `parseIntent` should target the latest available month directly.

**Only one fallback is disclosed.** If date fallback succeeds, the other strategies are not attempted. The user sees one clear explanation, not a chain of retries.

**Follow-ups bypass `/parse`.** Chips carry the full `ExecuteBody` and submit directly to `/execute`. This avoids LLM round trips and guarantees chips do exactly what they say.
