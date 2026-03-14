# DREDGE v4.1 → v5.1 TDD Migration Guide

> **Principle:** Nothing in v4.1 is removed. All changes are additive. Work through steps 1–6 in order. Steps 5 and 6 may be done in parallel once step 4 is merged.

---

## Overview of changes

| Area | What changes |
|---|---|
| Schemas | Three new Zod types: `FollowUp`, `FallbackInfo`, `ResultContext` |
| Database | New `ApiAvailability` model; two new analytics fields on `QueryJob` |
| Availability | New `availability.ts` module, loaded at startup |
| Adapter contract | `DomainAdapter` interface gains optional `recoverFromEmpty` hook |
| Crime recovery | New `recovery.ts` with three fallback strategies; `followups.ts` for chips |
| `query.ts` | Recovery hook called after empty fetch; `resultContext` added to response |
| Frontend | `FallbackBanner`, `FollowUpChips`, updated `EmptyResults`, `handleFollowUp` |

---

## Step 1 — New Zod schemas

### Branch: `feat/schemas-v5`

```bash
git checkout main && git pull
git checkout -b feat/schemas-v5
```

**What to add** — in `packages/schemas/src/index.ts`:

1. `FollowUpSchema` — `label: string` + `query: ExecuteBody`
2. `FallbackInfoSchema` — `field` enum (`date | location | category | radius`), `original`, `used`, `explanation`
3. `ResultContextSchema` — `status` enum (`exact | fallback | empty`), optional `reason`, optional `fallback`, `followUps[]`, `confidence` enum (`high | medium | low`)
4. Export all three types inferred from schemas

---

### Tests — `packages/schemas/src/__tests__/schemas-v5.test.ts`

**`FollowUpSchema`**
- [ ] valid object with `label` and a fully-formed `query` passes
- [ ] missing `label` throws a Zod error
- [ ] missing `query` throws a Zod error
- [ ] `query` with an unknown extra field passes (passthrough or strip depending on policy)

**`FallbackInfoSchema`**
- [ ] `field: "date"` is valid
- [ ] `field: "location"` is valid
- [ ] `field: "category"` is valid
- [ ] `field: "radius"` is valid
- [ ] `field: "unknown"` throws a Zod error
- [ ] all four string fields present — passes
- [ ] any required string field missing — throws

**`ResultContextSchema`**
- [ ] `status: "exact"` with no `reason` and empty `followUps` — passes
- [ ] `status: "fallback"` with a valid `fallback` object — passes
- [ ] `status: "empty"` with a `reason` string — passes
- [ ] `confidence: "high"` — passes; `confidence: "unknown"` — throws
- [ ] `followUps` containing an invalid chip — throws
- [ ] `fallback` present but with invalid `field` value — throws
- [ ] `reason` field is truly optional (absent → passes, present → passes)
- [ ] `fallback` field is truly optional (absent → passes, present → passes)

---

### Git

```bash
git add packages/schemas/
git commit -m "feat: schemas — FollowUp, FallbackInfo, ResultContext types"
git push -u origin feat/schemas-v5
# Open PR → review → merge → delete branch
```

---

## Step 2 — Database changes

### Branch: `feat/database-v5`

```bash
git checkout main && git pull
git checkout -b feat/database-v5
```

**What to add** — in `packages/database/prisma/schema.prisma`:

1. New `ApiAvailability` model:
   - `id` (cuid)
   - `source String @unique` — e.g. `"police-uk"`
   - `months String[]`
   - `fetchedAt DateTime @default(now())`
   - `@@map("api_availability")`

2. Add to existing `QueryJob` model:
   - `fallback_applied String?` — which strategy fired (`"date" | "radius" | "category"`)
   - `fallback_success Boolean?` — whether the fallback returned data

3. Generate and run migration:

```bash
npm run db:migrate --workspace=packages/database
npm run db:generate --workspace=packages/database
```

---

### Tests — `apps/orchestrator/src/__tests__/database-v5.test.ts`

Use a test Prisma client pointed at the dev database (or a seeded test database).

**`ApiAvailability` model**
- [ ] can insert a row with a unique `source` and an array of month strings
- [ ] inserting a second row with the same `source` throws a unique constraint error
- [ ] `fetchedAt` defaults to `now()` without being explicitly set
- [ ] `months` array can be empty (`[]`)
- [ ] `months` array with 12 entries round-trips correctly

**`QueryJob` — new fields**
- [ ] creating a `QueryJob` without `fallback_applied` or `fallback_success` succeeds (fields are nullable)
- [ ] updating an existing `QueryJob` to set `fallback_applied: "date"` and `fallback_success: true` persists correctly
- [ ] `fallback_applied` can be set to `null` explicitly after being set
- [ ] querying `QueryJob` rows where `fallback_applied IS NOT NULL` returns only rows that had a fallback

---

### Git

```bash
git add packages/database/
git commit -m "feat: database — ApiAvailability model, fallback analytics on QueryJob"
git push -u origin feat/database-v5
# Open PR → review → merge → delete branch
```

---

## Step 3 — Availability module

### Branch: `feat/availability`

```bash
git checkout main && git pull
git checkout -b feat/availability
```

**What to create** — `apps/orchestrator/src/availability.ts`:

- `loadAvailability(source, url, extractMonths)` — fetches URL, extracts month strings, stores in in-memory `Map` sorted most-recent-first; logs success as structured JSON; on network failure logs error and continues (non-fatal)
- `getLatestMonth(source)` — returns first entry from the map for `source`, or `null` if not loaded
- `isMonthAvailable(source, month)` — returns `true` if month in the list; returns `true` if store is empty (assume available)
- `getAvailableMonths(source)` — returns full array for source or `[]`

**What to modify** — `apps/orchestrator/src/index.ts`:

- Import `loadAvailability`
- Call it once for `"police-uk"` with the crimes-street-dates URL and the extractor `(data) => data.map(e => e.date)`

---

### Tests — `apps/orchestrator/src/__tests__/availability.test.ts`

Mock `axios` in all tests to avoid real HTTP calls.

**`loadAvailability`**
- [ ] after a successful load, `getAvailableMonths("police-uk")` returns the mocked month array
- [ ] months are stored sorted most-recent-first (e.g. `["2025-10", "2025-09", ...]`)
- [ ] calling `loadAvailability` a second time for the same source overwrites the previous data
- [ ] calling `loadAvailability` for a different source does not affect the first source's data
- [ ] when axios throws a network error, the function resolves without throwing
- [ ] when axios returns an empty array, store is set to empty array without error
- [ ] structured JSON is logged on success (`event: "availability_loaded"`)
- [ ] structured JSON is logged on failure (`event: "availability_failed"`)

**`getLatestMonth`**
- [ ] returns the most recent month string after a successful load
- [ ] returns `null` when the source has never been loaded
- [ ] returns `null` when the source was loaded but returned an empty array

**`isMonthAvailable`**
- [ ] returns `true` when the month is in the loaded list
- [ ] returns `false` when the month is not in the loaded list
- [ ] returns `true` when the source has never been loaded (assume available)
- [ ] returns `true` when the source was loaded with an empty list (assume available)
- [ ] month string format must match exactly — `"2025-10"` does not match `"2025-9"` or `"october-2025"`

**`getAvailableMonths`**
- [ ] returns full array after a successful load
- [ ] returns `[]` when source has never been loaded

---

### Git

```bash
git add apps/orchestrator/src/availability.ts apps/orchestrator/src/index.ts
git commit -m "feat: availability — multi-source availability cache, load Police API on startup"
git push -u origin feat/availability
# Open PR → review → merge → delete branch
```

---

## Step 4 — Adapter recovery hook

### Branch: `feat/adapter-recovery`

```bash
git checkout main && git pull
git checkout -b feat/adapter-recovery
```

**What to modify** — `apps/orchestrator/src/domains/registry.ts`:

- Import `FallbackInfo` from `@dredge/schemas`
- Add `recoverFromEmpty?` as an optional method on `DomainAdapter`:
  ```ts
  recoverFromEmpty?: (
    plan: any,
    locationArg: string,
    prisma: any,
  ) => Promise<{ data: unknown[]; fallback: FallbackInfo } | null>;
  ```

**What to modify** — `apps/orchestrator/src/domains/crime-uk.ts`:

- Import `recoverFromEmpty` from `../crime/recovery`
- Wire it onto `crimeUkAdapter`:
  ```ts
  recoverFromEmpty: (plan, poly, prisma) => recoverFromEmpty(plan, poly, prisma)
  ```

> At this point `recovery.ts` does not exist yet — keep the import but add a stub export that returns `null` so tests compile. The real implementation lands in step 5.

---

### Tests — `apps/orchestrator/src/__tests__/registry.test.ts` (additions)

**`DomainAdapter` interface compliance**
- [ ] an adapter object that omits `recoverFromEmpty` satisfies the `DomainAdapter` type (TypeScript compile-level check via `tsd` or a typed assignment)
- [ ] an adapter object that includes `recoverFromEmpty` also satisfies the interface

**`query.ts` recovery hook dispatch** (integration-style, mock the adapter)
- [ ] when `fetchData` returns a non-empty array, `recoverFromEmpty` is never called
- [ ] when `fetchData` returns `[]` and `recoverFromEmpty` is defined, it is called with `(plan, poly, prisma)`
- [ ] when `fetchData` returns `[]` and `recoverFromEmpty` is undefined, the pipeline continues without error
- [ ] when `recoverFromEmpty` returns `null`, the final result count is `0` and `resultContext.status` is `"empty"`
- [ ] when `recoverFromEmpty` returns a result, its `data` replaces the empty array and `fallback` is set on `resultContext`

---

### Git

```bash
git add apps/orchestrator/src/domains/
git commit -m "feat: adapter-recovery — recoverFromEmpty hook on DomainAdapter interface + crime-uk wired"
git push -u origin feat/adapter-recovery
# Open PR → review → merge → delete branch
```

---

## Step 5a — Crime recovery strategies

> Steps 5a and 5b can be developed in parallel once step 4 is merged, but `recovery.ts` and `followups.ts` must both be complete before `query.ts` is wired up.

### Branch: `feat/crime-recovery`

```bash
git checkout main && git pull
git checkout -b feat/crime-recovery
```

**What to create** — `apps/orchestrator/src/crime/recovery.ts`:

Three strategies tried in order, first success wins:

1. `recoverWithLatestMonth(plan, poly)` — if `plan.date_from` is not in availability list, retry with `getLatestMonth("police-uk")`; returns `null` if month is available (just no data) or if latest month also returns nothing
2. `recoverWithSmallerRadius(plan, poly, prisma)` — re-geocode with `2000m` radius, retry fetch; returns `null` if still empty or geocode fails
3. `recoverWithAllCrime(plan, poly)` — if `category !== "all-crime"`, retry with `all-crime`; returns `null` if category is already `all-crime` or if broadened fetch returns nothing

Main export: `recoverFromEmpty(plan, poly, prisma)` — chains the three strategies with `??`.

**What to create** — `apps/orchestrator/src/followups.ts`:

- `generateFollowUps(input: FollowUpInput): FollowUp[]`
- Dispatches on `input.domain` via `switch`
- `"crime-uk"` case → `generateCrimeUkFollowUps(input)`:
  - Single month → push `"See last 6 months"` chip (date_from = 6 months back)
  - Specific category (not `all-crime`) → push `"All crime types"` chip
  - `resultCount < 10` → push `"Widen search area"` chip
  - Cap at 4 chips with `.slice(0, 4)`
- Default case → return `[]` without throwing

**What to modify** — `apps/orchestrator/src/query.ts`:

- Remove direct imports of `fetchCrimes` and `storeResults` (now called via adapter)
- Add imports: `generateFollowUps` from `./followups`; `ResultContext`, `FallbackInfo` from `@dredge/schemas`
- After `fetchData` returns empty: call `adapter.recoverFromEmpty` if it exists, apply result
- Build `resultContext` from status, fallback, followUps, confidence
- Write `fallback_applied` and `fallback_success` to `QueryJob` on update
- Include `resultContext` in the JSON response
- Include `months_fetched` (use effective months if date fallback was applied)

---

### Tests — `apps/orchestrator/src/__tests__/recovery.test.ts`

Mock `fetchCrimes`, `getLatestMonth`, `isMonthAvailable`, and `geocodeToPolygon`.

**`recoverWithLatestMonth`**
- [ ] returns `null` when `getLatestMonth` returns `null` (availability not loaded)
- [ ] returns `null` when `isMonthAvailable` returns `true` for `plan.date_from` (month exists, just no data)
- [ ] returns `null` when the fallback fetch also returns `[]`
- [ ] returns a `RecoveryResult` with `fallback.field === "date"` when fetch succeeds
- [ ] `fallback.original` equals `plan.date_from`; `fallback.used` equals the latest month
- [ ] `fallback.explanation` is a non-empty string

**`recoverWithSmallerRadius`**
- [ ] returns `null` when geocode of smaller radius succeeds but fetch still returns `[]`
- [ ] returns a `RecoveryResult` with `fallback.field === "radius"` when fetch succeeds
- [ ] returns `null` (does not throw) when `geocodeToPolygon` throws
- [ ] `fallback.original` is `"5km"`; `fallback.used` is `"2km"`

**`recoverWithAllCrime`**
- [ ] returns `null` when `plan.category === "all-crime"` — does not retry
- [ ] returns `null` when the broadened fetch also returns `[]`
- [ ] returns a `RecoveryResult` with `fallback.field === "category"` when fetch succeeds
- [ ] `fallback.original` is the specific category; `fallback.used` is `"all-crime"`

**`recoverFromEmpty` (orchestrator)**
- [ ] when strategy 1 succeeds, returns its result and does not call strategies 2 or 3
- [ ] when strategy 1 returns null and strategy 2 succeeds, returns strategy 2's result
- [ ] when strategies 1 and 2 both return null and strategy 3 succeeds, returns strategy 3's result
- [ ] when all three strategies return null, returns `null`
- [ ] strategies are always tried in order 1 → 2 → 3 (verify call order with spies)

---

### Tests — `apps/orchestrator/src/__tests__/followups.test.ts`

All tests use a base `FollowUpInput` with `domain: "crime-uk"` and override fields as needed.

**Single-month logic**
- [ ] `date_from === date_to` → `"See last 6 months"` chip is included
- [ ] chip's `plan.date_from` is 6 months before the original date
- [ ] chip's `plan.date_to` equals the original `date_from` (unchanged)
- [ ] `date_from !== date_to` (multi-month) → `"See last 6 months"` chip is NOT included

**Category logic**
- [ ] `category !== "all-crime"` → `"All crime types"` chip is included
- [ ] `category === "all-crime"` → `"All crime types"` chip is NOT included
- [ ] chip's `plan.category` is `"all-crime"`

**Result count logic**
- [ ] `resultCount < 10` (e.g. 0, 5, 9) → `"Widen search area"` chip is included
- [ ] `resultCount === 10` → `"Widen search area"` chip is NOT included
- [ ] `resultCount > 10` → `"Widen search area"` chip is NOT included
- [ ] `resultCount === 0` (empty state) → chip is still included (not > 0 guard)

**Cap**
- [ ] when all three conditions fire simultaneously, result has at most 4 chips
- [ ] `slice(0, 4)` does not mutate the source array

**Domain routing**
- [ ] `domain: "weather-uk"` (unknown) → returns `[]` without throwing
- [ ] `domain: ""` (empty string) → returns `[]` without throwing
- [ ] `domain: "crime-uk"` → applies crime rules (covered above)

**Chip shape**
- [ ] every returned chip has a `label` (non-empty string)
- [ ] every returned chip has a `query` that is a valid `ExecuteBody`
- [ ] chips carry through unchanged `poly`, `resolved_location`, `country_code`, `intent` from input

---

### Git

```bash
git add apps/orchestrator/src/crime/recovery.ts \
        apps/orchestrator/src/followups.ts \
        apps/orchestrator/src/query.ts \
        apps/orchestrator/src/__tests__/recovery.test.ts \
        apps/orchestrator/src/__tests__/followups.test.ts
git commit -m "feat: crime-recovery — recovery.ts strategies, followups.ts, query.ts pipeline updates"
git push -u origin feat/crime-recovery
# Open PR → review → merge → delete branch
```

---

## Step 5b — Frontend changes

> Can be developed in parallel with step 5a. Requires step 4 to be merged first.

### Branch: `feat/frontend-v5`

```bash
git checkout main && git pull
git checkout -b feat/frontend-v5
```

**What to add to `App.tsx`:**

1. New type definitions:
   - `FallbackInfo` — mirrors backend schema
   - `FollowUp` — `label` + `query: ExecuteBody`
   - `ResultContext` — `status`, optional `reason`, optional `fallback`, `followUps[]`, `confidence`
   - `ExecuteBody` — full shape of execute request body

2. Update `ExecuteResult` to include `resultContext: ResultContext`

3. New component — `FallbackBanner({ fallback })`:
   - Amber left-bordered panel
   - Shows `⚠` icon + `fallback.explanation` text
   - Renders only when `resultContext.fallback` is defined

4. New component — `FollowUpChips({ followUps, onSelect })`:
   - Renders nothing when `followUps` is empty
   - Maps chips to amber-styled buttons
   - `onClick` calls `onSelect(f.query)` — passes pre-formed body, does not re-parse

5. Updated `EmptyResults`:
   - Accepts `resultContext: ResultContext` prop
   - Shows `resultContext.reason` when present
   - Renders `<FollowUpChips>` inside with `onSelect={onFollowUp}`
   - Retains existing "Refine query" button

6. New handler — `handleFollowUp(query: ExecuteBody)`:
   - Sets stage to `"loading"`; clears current result
   - POSTs directly to `/query/execute` — **no call to `/query/parse`**
   - On success: updates `parsed` state and `result` state, sets stage to `"done"`
   - On HTTP error: sets `intentError` and stage to `"error"`
   - On network failure: sets `intentError` with network message and stage to `"error"`

7. Updated render section (in order):
   - `InterpretationBanner` (existing, unchanged)
   - `FallbackBanner` — only when `result.resultContext.fallback` is defined
   - `ResultRenderer` — only when `result.count > 0`
   - `FollowUpChips` (below results) — when `count > 0` and chips exist
   - `EmptyResults` — when `count === 0` (with chips inside)

---

### Tests — `apps/orchestrator/src/__tests__/frontend-v5.test.ts`

Use React Testing Library. Mock `fetch`.

**`FallbackBanner`**
- [ ] renders `fallback.explanation` text
- [ ] renders the `⚠` character
- [ ] does not render when `fallback` is `undefined`

**`FollowUpChips`**
- [ ] renders nothing when `followUps` is an empty array
- [ ] renders one button per chip when array has items
- [ ] button label matches `chip.label`
- [ ] clicking a chip calls `onSelect` with the chip's `query` object exactly
- [ ] renders up to 4 chips; a 5-element array still only shows 4 (guard against over-render)

**`EmptyResults`**
- [ ] renders "No results found" heading
- [ ] renders `resultContext.reason` when provided
- [ ] does not render reason element when `reason` is undefined
- [ ] renders `FollowUpChips` when `resultContext.followUps` is non-empty
- [ ] "Refine query" button calls `onRefine`

**`handleFollowUp`**
- [ ] sets stage to `"loading"` before the fetch
- [ ] POSTs to `/query/execute` (not `/query/parse`)
- [ ] request body is the `ExecuteBody` passed as argument — no modification
- [ ] on 200 response: stage becomes `"done"`, `result` is set, `parsed` is updated
- [ ] on non-200 response: stage becomes `"error"`, `intentError` is set
- [ ] on network failure: stage becomes `"error"`, `intentError` message is network message

**Render integration — result with fallback**
- [ ] when `result.resultContext.status === "fallback"`, `FallbackBanner` is visible
- [ ] when `result.resultContext.status === "exact"`, `FallbackBanner` is not rendered
- [ ] `FollowUpChips` appears below results when `count > 0` and chips exist
- [ ] `FollowUpChips` appears inside `EmptyResults` when `count === 0`

**Edge cases**
- [ ] `resultContext` missing from API response → app does not crash (treat as `status: "exact"`, no banner, no chips)
- [ ] `followUps` is `null` or `undefined` in response → chips render empty, no crash
- [ ] chip query submitted while another request is in flight → loading state is shown and prior result is cleared

---

### Git

```bash
git add apps/frontend/src/App.tsx \
        apps/orchestrator/src/__tests__/frontend-v5.test.ts
git commit -m "feat: frontend — fallback banner, follow-up chips, empty state with suggestions"
git push -u origin feat/frontend-v5
# Open PR → review → merge → delete branch
```

---

## Coverage check (run after all branches merged)

```bash
npm run test:coverage --workspace=apps/orchestrator
```

- [ ] all tests passing
- [ ] line coverage above 80%
- [ ] branch coverage above 70%

---

## Manual smoke tests (run against running app)

| Query | What to verify |
|---|---|
| `bicycle theft in Cambridge` (no date) | Date fallback banner appears; chips shown below map |
| `burglaries in Cambridge in January 2024` | No banner; chips shown; `resultContext.status === "exact"` |
| `crime in Romford` | If boundary clip → radius shrink banner shown |
| `unicycle theft in Cambridge` | Category broadened banner; `"All crime types"` chip not shown (already broadened) |
| Same query twice | Second run shows `(cached)` badge; `resultContext` still returned |
| Query with guaranteed no data | Empty state with at least one follow-up chip; not a dead end |
| Click a follow-up chip | Executes without going through `/parse`; new results or empty state shown |
| `crime in New York last month` | Unsupported region error; no crash |
| Network disconnected mid-request | "Lost connection" error message shown; stage returns to error cleanly |

---

## Key architectural invariants to protect

- `query.ts` must have **no direct crime imports** after step 5 — all crime logic flows through adapter methods
- `recoverFromEmpty` on the adapter is **always optional** — `query.ts` checks for existence before calling
- Follow-up chips call `/execute` directly — **never `/parse`**
- Only the **first** successful fallback strategy is applied and disclosed — strategies short-circuit with `??`
- `isMonthAvailable` returns `true` when availability is not loaded — fail open, not fail closed

---

## Useful commands reference

| Action | Command |
|---|---|
| Run tests | `npm test --workspace=apps/orchestrator` |
| Run coverage | `npm run test:coverage --workspace=apps/orchestrator` |
| Run dev | `npm run dev` |
| New DB migration | `npm run db:migrate` |
| Regenerate Prisma client | `npm run db:generate` |
| Inspect QueryJob fallback fields | `npm run db:studio` → QueryJob table |
| Inspect availability cache | `npm run db:studio` → ApiAvailability table |
| Check availability loaded | Look for `event: "availability_loaded"` in server stdout |
