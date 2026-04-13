# Deferred Features

Items intentionally deferred — not forgotten. Each entry records what was decided, why it was deferred, and what triggers it becoming priority.

---

## D1 — Option C: Temporal intent field

**What:** Replace `date_from`/`date_to` in the LLM query plan output with a single `temporal` free-text field (e.g. `"unspecified"`, `"last month"`, `"january 2026"`, `"next week"`). Each domain adapter implements a `resolveTemporalRange(temporal)` function that converts this to actual date ranges based on the adapter's own data coverage and availability.

**Why deferred:** ~20 files affected, full feature cycle. Current workaround (Option B: `date_explicit` flag) covers most cases. Risk of breaking working queries during migration.

**Why it matters:** Current approach forces LLM to output YYYY-MM format regardless of domain. Weather wants day-level forecasts, crime wants the latest available month from the availability cache, flood risk and cinemas are always live. The mismatch causes subtle failures that Option B can't fully resolve (e.g. user explicitly asks "last month's weather" but adapter overrides to a forecast).

**Trigger:** All 6 query cycles working reliably in production.

**Scope when actioned:**
- `packages/schemas/src/index.ts` — add `temporal: string`, keep `date_from`/`date_to` as resolved values
- `apps/orchestrator/src/intent.ts` — rewrite system prompt, add temporal resolver
- `apps/orchestrator/src/query.ts` — temporal resolution step after adapter selection
- Each domain adapter — implement `resolveTemporalRange`
- `apps/web/src/App.tsx` — update plan date display
- ~15 test files

---

## D2 — Transport domain adapter

**What:** A `transport` domain adapter (bus/rail/tube) to back the "Show nearby transport" chip that capability inference generates for any result with coordinates.

**Why deferred:** No data source identified yet. Chip removed from capability inference to avoid dead buttons.

**Trigger:** Data source identified (e.g. Traveline TNDS, National Rail open data, TfL API).

---

## D3 — Recovery path for historical weather gaps

**What:** `recoverFromEmpty` in the weather adapter currently only handles future dates (no forecast available). There is no recovery when a historical date range returns empty — e.g. archive API gap for very recent months.

**Why deferred:** The 90-day forecast fallback covers the most common case. True archive gaps are rare.

**Trigger:** User reports empty results for historical weather queries more than 30 days old.

---

## D4 — Session infrastructure in main repo ✅ PARTIALLY DONE

**What:** F1 (session headers) and F2 (await loadAvailability) applied to main. F3/F4/F5 from worktree still pending:
- F3: Availability cache reads from Redis on miss
- F4: Structured logging on silent catch blocks in query.ts
- F5: `normalizePlan` called before cache hash + date clamping

**Trigger:** Next maintenance pass.

---

## D5 — Forecast end-date clamping user notification

**What:** When a requested date range extends beyond the forecast API's 16-day window, the end date is silently clamped with no user notification.

**Why deferred:** Silent truncation is better than a 400 error. Low frequency.

**Trigger:** UX pass after all query cycles complete.

---

## D6 — Tier 2 refinement: domain-match guard

**What:** The Tier 2 refinement system detects "location_shift" on any query containing "in [Place]" and merges it with the previous active_plan, corrupting plan dates.

**Current state:** Refinement block disabled in query.ts (commented out).

**Fix needed:** Check that the new query's intent matches the domain of active_plan before applying refinement. If domains differ, treat as fresh query.

**Trigger:** All 6 query cycles working. Re-enable once domain guard is implemented.

---

## D8 — Hunting zones: stale data source, new endpoint needed

**What:** The Natural England CRoW Open Access Land ArcGIS endpoint is dead — `environment.data.gov.uk/arcgis/rest/services/NE/CRoW_Open_Access_Land/FeatureServer/0/query` returns 400 Invalid URL even when queried directly.

**Code fixes already applied:**
- `returnGeometry=true` replaces unsupported `returnCentroid=true`
- Geometry param sent as JSON object via `parsePoly.toArcGisEnvelope()`

**Remaining blocker:** Find the new NE CRoW endpoint. Candidates:
- `https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/`
- `https://naturalengland-defra.opendata.arcgis.com/`

**Fix:** One-line `BASE_URL` change in `hunting-zones-gb/fetcher.ts` once correct URL is found.

---

## D11 — Discovery layer: SERP 401 + Stagehand null extraction

**What:** Domain discovery always fails:
1. SERP API key missing/expired (401) → falls back to browser crawler
2. Stagehand/gpt-4o-mini returns `{"url":"null","description":"null"}` — missing required `format` field, Zod rejects it
3. Discovery triggers even when curated registry already matched

**Fixes needed:**
1. Renew SERP API key
2. Fix Stagehand extraction prompt — empty results should return `[]`, not null-filled objects
3. Guard: skip discovery when curated registry already matched

**Scope:** `agent/workflows/domain-discovery-workflow.ts`, env config.

---

## D13 — Curated registry management and source promotion pipeline

**What:** No promotion path from dynamic discovery → curated → adapter. Each discovery run starts from scratch. No admin visibility, no health tracking.

**Proposed model:** Discovered sources go to DB with `pending → approved → curated` status. Admin endpoint promotes approved sources. Auto-promote after N successful uses.

**Rule of thumb:**
- Static national feed → curated registry entry
- Location-filtered or needs recovery → full DomainAdapter
- Unverified → dynamic, review before promoting

**Trigger:** After all 6 query cycles stable and discovery pipeline producing valid candidates.

---

## D15 — Stagehand crawler storage directory missing

**What:** Stagehand tries to create lock files under `apps/orchestrator/storage/request_queues/default/` — directory missing, causes ENOENT, crawler processes 0 requests.

**Fix:** Create directory on startup or configure Stagehand to use a temp directory.

---

## D16 — Food hygiene: location-based search + optional map view

**What:** The FSA Ratings API returns 0 geocodes for most establishments when searching by address string. Currently using table viz hint as workaround.

**Simpler fix (no background jobs):** Switch fetcher to use `?lat=X&lng=Y&pageSize=100` — results from this endpoint include geocodes. Coordinates available from geocoder already.

**Background job approach:** Geocode stored establishments post-insert, update `lat`/`lon` in `query_results`. Rate-limit to ~1 req/s for Nominatim.

**Trigger:** When map view for food hygiene is wanted.

---

## D17 — Map coordinate field naming inconsistency

**What:** `LegacyMapView` in `ResultRenderer.tsx` and `MapView` in `App.tsx` both assumed `longitude`/`latitude` field names. `query_results` stores `lon`/`lat`. Fixed in App.tsx and ResultRenderer.tsx during Phase 4, but worth noting as a pattern — any new map component must handle both `lon`/`lat` and `longitude`/`latitude`.

**Fix applied:** Both map components now use `c.lon ?? c.longitude` and `c.lat ?? c.latitude`.

**Remaining risk:** Other map components added in future may repeat this mistake.

**Trigger:** When adding new map components — establish a single canonical field name and enforce it.
