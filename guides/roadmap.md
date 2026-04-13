# DREDGE Fix Roadmap

Big-picture contract fixes first, then each subsequent phase validates those fixes by making a real query work. Each phase has a clear "done when" criterion: the test query returns correct, location-appropriate results.

---

## Phase 1 — Foundation contracts (no user-facing query)

Fix the three under-specified contracts that cause failures across all domains. No new features — just make the plumbing reliable.

### 1a. Polygon utility — `parsePoly`

The geocoder outputs `lat,lon:lat,lon:...` (16-point circle, 5km radius, PostGIS ST_Project). Each consumer parses this differently:

- Crime: passes verbatim to police.uk ✅
- Hunting zones: splits on `,` and `:` then assigns lat→lon and lon→lat — **swapped** ❌
- Cinemas: splits on `:`, replaces `,` with space — correct format but 0 results (investigate)
- Curated REST: ignores it ❌

**Fix:** Create a shared `parsePoly(poly: string)` utility that returns structured output:
- `.pairs` → `[{lat, lon}, ...]`
- `.toBbox()` → `{xmin, ymin, xmax, ymax}` (WGS84: x=lon, y=lat)
- `.toOverpassPoly()` → `"lat1 lon1 lat2 lon2 ..."`
- `.toPoliceUk()` → `"lat,lon:lat,lon:..."` (passthrough)
- `.centroid()` → `{lat, lon}`

**Scope:** New file `apps/orchestrator/src/poly.ts`. Each adapter imports and uses the appropriate method.

**Fixes:** D8 (hunting zones bbox), D10 (cinemas Overpass format — confirms or rules out poly as cause)

### 1b. Unified storage — D14

Migrate crime from `crime_results` to `query_results`. Remove the table-name branching in query.ts readback.

- Rewrite `crime-uk/store.ts` to use `prisma.queryResult.createMany` with correct field mapping: `lat`, `lon`, `category`, `date`, `location`, `description`, `extras`, `raw`, **`query_id`**
- Change spatial aggregation trigger from `tableName === "crime_results"` to a config flag: `spatialAggregation: true`
- Update PostGIS SQL to query `query_results` using `lat`/`lon` + `WHERE query_id = ...`
- Prisma migration to drop `crime_results` table and `CrimeResult` model
- Update all other adapters' `storeResults` to include `query_id` (cinemas, hunting zones, curated)
- Update all readback paths to filter by `query_id` (not just `domain_name`)

**Scope:** `crime-uk/store.ts`, `query.ts` (readback logic), `schema.prisma`, `cinemas-gb/index.ts`, `hunting-zones-gb/index.ts`, curated adapter in `query.ts`

### 1c. Curated location params — D12

Add a `locationParams` field to `CuratedSource` so REST sources can inject lat/lon into the URL.

```typescript
locationParams?: {
  latParam: string;   // e.g. "lat"
  lonParam: string;   // e.g. "long"
  radiusParam?: string; // e.g. "dist"
  radiusKm?: number;    // e.g. 20
};
```

The `fetchData` closure in query.ts reads `locationParams`, gets lat/lon from the geocoder result, and appends them as query string params before calling `createRestProvider`.

**Scope:** `curated-registry.ts` (type + flood risk entry), `query.ts` (fetchData closure)

### 1d. Merge worktree fixes — D4

Merge F3 (availability cache Redis fallback), F4 (structured logging), F5 (normalizePlan before cache hash) from this worktree to main.

**Scope:** Cherry-pick or merge `interesting-grothendieck` worktree changes.

### Done when

- `parsePoly` exists and has unit tests
- Crime writes to `query_results`, readback filters by `query_id`
- Curated sources can pass location params
- F3/F5 merged
- All existing tests pass

---

## Phase 2 — Crime query (validates D14 + store contract)

**Test query:** "crime in Manchester"

**What it validates:**
- Crime store writes to `query_results` with correct fields and `query_id`
- PostGIS spatial aggregation reads from `query_results` with `query_id` filter
- Availability pre-filtering works (F3/F5 merged from Phase 1d)
- Recovery chain fires correctly when months are unavailable
- Map displays Manchester, not somewhere else

**Expected result:** `rows_inserted > 0`, map centred on Manchester with crime clusters.

**Additional test queries:**
- "vehicle crime in Leeds last 3 months" — category normalisation + multi-month
- "crime in Edinburgh" — Scottish force coverage

---

## Phase 3 — Flood risk + Hunting zones (validates D12 + parsePoly + D8)

Two queries that together validate location filtering across both the curated registry and DomainAdapter paths.

### 3a. Flood risk

**Test query:** "flood risk in York"

**What it validates:**
- Curated `locationParams` injects `?lat=53.96&long=-1.08&dist=20` into EA floods URL
- Map shows York area warnings, not national feed

**Fix:** Add `locationParams` to the flood risk curated entry:
```typescript
locationParams: { latParam: "lat", lonParam: "long", radiusParam: "dist", radiusKm: 20 }
```

### 3b. Hunting zones

**Test query:** "hunting zones near Inverness"

**What it validates:**
- `parsePoly.toBbox()` produces correct WGS84 bbox (x=lon, y=lat)
- ArcGIS geometry param sent as JSON object, not comma-separated string
- Endpoint is live and returns features
- Store includes `query_id`

**Fix:** Rewrite `polyToBbox` to use `parsePoly`, fix geometry format to `JSON.stringify({xmin, ymin, xmax, ymax})`. Verify BASE_URL is still valid.

---

## Phase 4 — Cinemas (validates parsePoly Overpass path)

**Test query:** "cinemas in Glasgow"

**What it validates:**
- `parsePoly.toOverpassPoly()` produces valid Overpass poly filter
- Overpass returns cinema elements for Glasgow
- Store includes `query_id`
- Map shows Glasgow cinemas

**Diagnostic first:** Add `data.elements.length` log to `fetchCinemas` before the filter step. If Overpass genuinely returns 0 elements, the polygon may be too tight (5km might miss city-edge cinemas) or the Overpass poly filter might need a bbox fallback.

**Possible additional fix:** If poly filter is too tight, fall back to Overpass `around:` filter using centroid + radius instead of polygon.

---

## Phase 5 — Food business (new adapter — D9)

**Test query:** "food businesses in Birmingham"

**What it builds:**
- New `food-hygiene-gb` DomainAdapter backed by FSA Hygiene Ratings API (`https://api.ratings.food.gov.uk/`)
- Fetcher: search by local authority or lat/lon, returns establishment name, address, rating, business type
- Store: writes to `query_results` with `query_id` (follows Phase 1b contract)
- CATEGORY_TO_INTENT: `"food business registrations"` → `"food hygiene"` (or similar)
- Fix auto-approve boundary: `>=` instead of `>` for discovery threshold

**Expected result:** Table/map of food businesses in Birmingham with hygiene ratings.

---

## Phase 6 — Polish and deferred architectural work

Lower priority items that don't block any query cycle but improve robustness.

| Item | What | Trigger |
|------|------|---------|
| D1 | Temporal intent field — replace YYYY-MM with free-text temporal | All 6 cycles stable |
| D6 | Re-enable Tier 2 refinement with domain-match guard | All 6 cycles stable |
| D11 | Discovery: fix SERP key, Stagehand extraction prompt | When discovery is needed for new domains |
| D13 | Source promotion pipeline (discovered → curated → adapter) | When discovery produces useful results |
| D3 | Weather recovery for historical archive gaps | User reports |
| D5 | Forecast end-date clamping user notification | UX pass |
| D2 | Transport domain adapter | Data source identified |

---

## Summary

| Phase | Query | Validates | Key deferred items |
|-------|-------|-----------|-------------------|
| 1 | — (infra) | Polygon contract, store contract, curated location | D4, D12, D14 |
| 2 | Crime in Manchester | Unified storage, spatial aggregation, availability | D14 |
| 3 | Flood risk in York + Hunting zones near Inverness | Curated location params, parsePoly bbox | D8, D12 |
| 4 | Cinemas in Glasgow | parsePoly Overpass, diagnostic | D10 |
| 5 | Food businesses in Birmingham | New adapter, intent routing | D9 |
| 6 | — (polish) | Temporal, refinement, discovery | D1, D3, D5, D6, D11, D13 |
