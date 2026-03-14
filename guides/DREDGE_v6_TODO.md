# DREDGE v6.0 — Build Checklist

Each step is a self-contained branch. Complete all tasks in a step before committing and opening a pull request. Test expectations must pass before the PR is merged. Steps within a phase must be completed in order unless noted otherwise.

---

## Phase 1 — Infrastructure Hardening

Steps 1 → 2 → 3 must be done in order. Step 4 can follow in any order after Step 3 is merged.

---

### Step 1 — Connection pooling

**Branch**
- [ ] Checkout main and pull latest
- [ ] Create branch `infra/connection-pooling`

**Tasks**
- [ ] Decide on pooling approach: PgBouncer (Docker Compose service) or Prisma built-in `connection_limit` on the database URL
- [ ] If PgBouncer: add PgBouncer as a new service in `docker-compose.yml` pointing at the Postgres service
- [ ] If PgBouncer: update `DATABASE_URL` in the orchestrator `.env` to connect through the bouncer port
- [ ] If Prisma built-in: add `connection_limit` and `pool_timeout` parameters to the `DATABASE_URL` string
- [ ] Set pool size to 10 as a starting point — leaves headroom for Prisma Studio and admin connections
- [ ] Start the database with `docker compose up -d` and confirm both Postgres and (if applicable) PgBouncer services start cleanly
- [ ] Run the app with `npm run dev` and confirm no connection errors on startup

**Test expectations**
- [ ] Run 20 rapid sequential queries — no "too many clients" error appears from Postgres
- [ ] Open `pg_stat_activity` via Prisma Studio or psql — active connection count stays bounded and does not climb with query volume
- [ ] Run a single query and confirm latency is not measurably worse than before pooling was introduced
- [ ] Open Prisma Studio while the orchestrator is running — Studio connects without errors

**Git**
- [ ] `git add .`
- [ ] `git commit -m "infra: connection pooling — PgBouncer / Prisma pool config"`
- [ ] `git push origin infra/connection-pooling`
- [ ] Open pull request → merge → delete branch
- [ ] Checkout main and pull latest

---

### Step 2 — Parallel month fetching

**Branch**
- [ ] Checkout main and pull latest
- [ ] Create branch `infra/parallel-fetch`

**Tasks**
- [ ] Add `p-limit` as a dependency in the orchestrator workspace: `npm install p-limit --workspace=apps/orchestrator`
- [ ] Open the crime adapter's `fetchData` method and locate the sequential loop that calls the Police API once per month
- [ ] Replace the sequential loop with concurrent fetching capped at 3 simultaneous requests using `p-limit`
- [ ] Confirm the output of the new implementation is a flat array of all crime records across all months — identical shape to the sequential version
- [ ] Confirm that no changes are needed in `query.ts`, the domain registry, or any schema file — the adapter's public interface is unchanged
- [ ] Run `npm run dev` and confirm the app starts cleanly

**Test expectations**
- [ ] Run a query spanning 6 months — confirm it completes in under half the time compared to the sequential implementation
- [ ] Confirm the total row count returned matches what the sequential implementation returned for the same query inputs
- [ ] Run a single-month query — confirm behaviour is identical to before, no regression
- [ ] Inspect server logs — confirm fetch activity for multiple months overlaps in time rather than completing in strict sequence
- [ ] Simulate a Police API error for one month (e.g. point one month at a bad URL in dev) — confirm the other months still return successfully and the failing month is skipped cleanly

**Git**
- [ ] `git add .`
- [ ] `git commit -m "infra: parallel month fetching — p-limit concurrency cap on crime adapter"`
- [ ] `git push origin infra/parallel-fetch`
- [ ] Open pull request → merge → delete branch
- [ ] Checkout main and pull latest

---

### Step 3 — Per-adapter rate limiting

**Branch**
- [ ] Checkout main and pull latest
- [ ] Create branch `infra/rate-limiting`

**Tasks**
- [ ] Add an optional `rateLimit: { requestsPerMinute: number }` field to `DomainConfig` in `packages/schemas/src/index.ts`
- [ ] Run `npm run build --workspace=packages/schemas` to confirm the schema update compiles cleanly
- [ ] Create `apps/orchestrator/src/rateLimiter.ts` — a token bucket implementation keyed by adapter name, refilling at the rate defined in `DomainConfig`
- [ ] In `query.ts`, add a call to the rate limiter before `adapter.fetchData` — consume a token if available, wait if not. Do not reject requests; queue them
- [ ] Add `rateLimit: { requestsPerMinute: 30 }` to the crime-uk `DomainConfig` entry as a conservative starting point
- [ ] Write unit tests in `apps/orchestrator/src/__tests__/rate-limiter.test.ts` covering: token consumption, queuing when the bucket is empty, no delay when no rate limit is configured, and confirmed bypass for cache hits
- [ ] Run `npm test --workspace=apps/orchestrator` and confirm all tests pass

**Test expectations**
- [ ] Run a 12-month query — confirm server logs show requests spaced over time rather than all firing simultaneously
- [ ] Confirm no requests are dropped — all 12 months eventually return results
- [ ] Run a query for a domain with no `rateLimit` field configured — confirm it completes with no artificial delay
- [ ] Run a cached query — confirm the rate limiter is bypassed entirely and the response is immediate
- [ ] Run `npm test --workspace=apps/orchestrator` — all rate limiter unit tests pass

**Git**
- [ ] `git add .`
- [ ] `git commit -m "infra: rate limiting — token bucket per adapter via DomainConfig"`
- [ ] `git push origin infra/rate-limiting`
- [ ] Open pull request → merge → delete branch
- [ ] Checkout main and pull latest

---

### Step 4 — Cache TTL policy

**Branch**
- [ ] Checkout main and pull latest
- [ ] Create branch `infra/cache-ttl`

**Tasks**
- [ ] Add an optional `cacheTtlHours: number | null` field to `DomainConfig` in `packages/schemas/src/index.ts`
- [ ] Run `npm run build --workspace=packages/schemas` to confirm the update compiles cleanly
- [ ] In `query.ts`, update the `QueryCache` lookup to check the TTL after a cache hit is found — if `cacheTtlHours` is set and the entry is older than the TTL, treat it as a miss
- [ ] On a stale cache hit: delete the expired entry before proceeding to live execution, to prevent duplicate rows accumulating on the same hash
- [ ] Add `stale_cache_evicted: true` to the structured log output when a stale entry is evicted
- [ ] Set `cacheTtlHours: null` on the crime-uk `DomainConfig` — historical data never expires
- [ ] Note: the weather domain config (Step 8) will use `cacheTtlHours: 1` — no weather changes needed yet
- [ ] Write unit tests in `apps/orchestrator/src/__tests__/cache-ttl.test.ts` covering: TTL expiry triggers a miss, stale eviction deletes the old row, null TTL never expires, fresh entry after eviction is returned as a hit

**Test expectations**
- [ ] Run a crime query twice — second run is a cache hit after 24 hours (simulate by temporarily setting a 0-hour TTL and confirming expiry, then restore null)
- [ ] Set a 1-hour TTL on a test domain — confirm a cache entry older than 61 minutes is treated as a miss
- [ ] Confirm server logs include `stale_cache_evicted: true` when an expired entry is evicted
- [ ] Confirm Prisma Studio shows no duplicate rows in `QueryCache` for the same hash after a stale eviction
- [ ] Run `npm test --workspace=apps/orchestrator` — all cache TTL unit tests pass

**Git**
- [ ] `git add .`
- [ ] `git commit -m "infra: cache TTL — expiry policy on QueryCache with stale eviction"`
- [ ] `git push origin infra/cache-ttl`
- [ ] Open pull request → merge → delete branch
- [ ] Checkout main and pull latest

---

## Phase 2 — Spatial Aggregation and Export

Steps 5 and 6 can be done in either order. Step 7 must follow both.

---

### Step 5 — Spatial aggregation

**Branch**
- [ ] Checkout main and pull latest
- [ ] Create branch `feat/spatial-aggregation`

**Tasks**
- [ ] Add `AggregatedBin` as a new type in `packages/schemas/src/index.ts` with fields `lat`, `lon`, and `count`
- [ ] Update `ExecuteResult` in `packages/schemas/src/index.ts` to include an `aggregated: boolean` flag and accept either raw result rows or an `AggregatedBin` array in the `results` field
- [ ] Run `npm run build --workspace=packages/schemas` to confirm the update compiles cleanly
- [ ] In `query.ts`, after `adapter.storeResults` completes, add a branch on `viz_hint`:
  - For `map` or `heatmap`: run a PostGIS `ST_SnapToGrid` aggregation query against the result table, returning one row per cell with centroid coordinates and incident count. Use approximately 200 metre grid resolution as the default
  - For `bar`, `table`, or `dashboard`: continue using `findMany` for raw rows as before
- [ ] Add `aggregated: true` to the execute response when binning was applied, `aggregated: false` otherwise
- [ ] Update `QueryCache` writes to store aggregated bins (not raw rows) for map and heatmap queries
- [ ] Write unit tests in `apps/orchestrator/src/__tests__/aggregation.test.ts` covering: bin count is bounded for large result sets, bin shape matches `AggregatedBin`, `viz_hint: "bar"` returns raw rows with `aggregated: false`, aggregation result is deterministic across identical queries

**Test expectations**
- [ ] Run a single-month map query for a busy area — confirm the response contains fewer than 500 result objects regardless of raw row count
- [ ] Confirm each result object in an aggregated response has exactly `lat`, `lon`, and `count` fields — no domain-specific crime fields
- [ ] Confirm the execute response includes `aggregated: true`
- [ ] Run a bar chart query for the same area — confirm raw monthly counts are returned and `aggregated: false`
- [ ] Run the same map query twice — confirm bin coordinates are identical both times
- [ ] Open Prisma Studio — confirm raw crime rows still exist in the result table after an aggregated query; source data is not affected
- [ ] Confirm the `QueryCache` entry for a map query stores aggregated bins rather than raw rows
- [ ] Run `npm test --workspace=apps/orchestrator` — all aggregation unit tests pass

**Git**
- [ ] `git add .`
- [ ] `git commit -m "feat: spatial aggregation — PostGIS binning for map and heatmap viz hints"`
- [ ] `git push origin feat/spatial-aggregation`
- [ ] Open pull request → merge → delete branch
- [ ] Checkout main and pull latest

---

### Step 6 — Export endpoints

**Branch**
- [ ] Checkout main and pull latest
- [ ] Create branch `feat/export-endpoints`

**Tasks**
- [ ] Add a `GET /query/:id/export` endpoint to the orchestrator router accepting a `format` query parameter
- [ ] For `format=csv`: look up raw rows for the given `query_id` using `findMany` with no row cap, serialise to CSV with a header row, and return as a streaming file attachment with `Content-Type: text/csv` and `Content-Disposition: attachment` headers
- [ ] For `format=geojson`: look up raw rows, wrap each as a GeoJSON `Feature` with a `Point` geometry using the row's `latitude` and `longitude` fields and all remaining fields as `properties`, return the resulting `FeatureCollection` as a file attachment
- [ ] Return HTTP 404 with a clear message if the `query_id` does not exist or has no rows
- [ ] Return HTTP 400 with a clear message if `format` is anything other than `csv` or `geojson`
- [ ] Confirm export endpoints bypass the rate limiter — they read from Postgres only
- [ ] Write unit tests in `apps/orchestrator/src/__tests__/export.test.ts` covering: CSV has a header row and correct row count, GeoJSON passes lint validation, coordinates are in `[longitude, latitude]` order, 404 on unknown query ID, 400 on unsupported format

**Test expectations**
- [ ] Call `GET /query/:id/export?format=csv` for a known query — browser triggers a `.csv` file download with `Content-Type: text/csv`
- [ ] Open the downloaded CSV — confirm it has a header row and the row count matches Prisma Studio for that `query_id`
- [ ] Call `GET /query/:id/export?format=geojson` — browser triggers a GeoJSON file download
- [ ] Run the downloaded GeoJSON through a linter — it passes as valid GeoJSON
- [ ] Confirm each GeoJSON feature has coordinates in `[longitude, latitude]` order
- [ ] Call the endpoint with an unknown `query_id` — confirm HTTP 404 response
- [ ] Call the endpoint with `format=xml` — confirm HTTP 400 response with a clear error message
- [ ] Export a query with 1000+ rows — confirm the server does not produce an out-of-memory error
- [ ] Run `npm test --workspace=apps/orchestrator` — all export unit tests pass

**Git**
- [ ] `git add .`
- [ ] `git commit -m "feat: export endpoints — CSV and GeoJSON download via query ID"`
- [ ] `git push origin feat/export-endpoints`
- [ ] Open pull request → merge → delete branch
- [ ] Checkout main and pull latest

---

### Step 7 — Frontend download button and aggregation-aware rendering

**Branch**
- [ ] Checkout main and pull latest
- [ ] Create branch `feat/frontend-v6-data`

**Tasks**
- [ ] In `ResultRenderer`, update the map rendering path to inspect the `aggregated` flag on the execute response:
  - If `aggregated: true`: pass the `AggregatedBin` array to the map component, using the `count` field for heatmap cell intensity
  - If `aggregated: false`: existing rendering path is unchanged
- [ ] Add a download toolbar below the result visualisation with two buttons: "Download CSV" and "Download GeoJSON"
- [ ] Each button constructs the appropriate export URL from `result.query_id` and triggers a browser file download
- [ ] Show download buttons only when `result.count > 0` — no download affordance on empty states
- [ ] Do not show the download toolbar on weather dashboard results (viz_hint of `"dashboard"`) — weather export is handled in Step 10
- [ ] Run `npm run dev` and confirm the app starts cleanly with no type errors

**Test expectations**
- [ ] Run a map query for a large area — confirm the map renders without lag and the network tab shows fewer than 500 result objects
- [ ] Confirm "Download CSV" and "Download GeoJSON" buttons appear below the result
- [ ] Click "Download CSV" — confirm a file downloads without the page navigating away
- [ ] Click "Download GeoJSON" — confirm a GeoJSON file downloads
- [ ] Run a query that returns no results — confirm no download buttons appear
- [ ] Run a bar chart query — confirm download buttons still appear and function correctly
- [ ] Run a crime query — confirm `MapView` renders as before with no regression in the points, clusters, and heatmap mode buttons

**Git**
- [ ] `git add .`
- [ ] `git commit -m "feat: frontend v6 data — download buttons and aggregation-aware map rendering"`
- [ ] `git push origin feat/frontend-v6-data`
- [ ] Open pull request → merge → delete branch
- [ ] Checkout main and pull latest

---

## Phase 3 — Weather Domain and LLM Summaries

Steps 8 → 9 → 10 → 11 must be done in order.

---

### Step 8 — Weather domain schemas and config

**Branch**
- [ ] Checkout main and pull latest
- [ ] Create branch `feat/schemas-weather`

**Tasks**
- [ ] In `packages/schemas/src/index.ts`, extend the `VizHint` type to include `"dashboard"` as a valid value alongside `"map"`, `"bar"`, and `"table"`
- [ ] In `packages/schemas/src/index.ts`, add a `WeatherQueryPlan` schema with fields: `location` (string), `date_from` (YYYY-MM-DD string), `date_to` (YYYY-MM-DD string), and optional `metric` (enum of `"temperature"`, `"precipitation"`, `"wind"`)
- [ ] Run `npm run build --workspace=packages/schemas` to confirm both additions compile cleanly
- [ ] In `packages/database/prisma/schema.prisma`, add a `WeatherResult` model with fields: `id`, `query_id` (relation to `Query`), `date`, `latitude`, `longitude`, `temperature_max`, `temperature_min`, `precipitation`, `wind_speed`, `description`, and `raw Json?`. Table name: `weather_results`
- [ ] Run `npm run db:migrate` to generate and apply the migration
- [ ] Run `npm run db:generate` to regenerate the Prisma client
- [ ] In the orchestrator, add the weather `DomainConfig` entry to the registry config file with: `name: "weather"`, `tableName: "weather_results"`, `prismaModel: "weatherResult"`, `countries: []` (global), `intents: ["weather"]`, `cacheTtlHours: 1`, `rateLimit: { requestsPerMinute: 60 }`
- [ ] Update `deriveVizHint` in the orchestrator to return `"dashboard"` for any query where the resolved intent is `"weather"` — this derivation is deterministic and does not involve the LLM

**Test expectations**
- [ ] Run `npm run db:migrate` — migration runs without errors
- [ ] Open Prisma Studio — `WeatherResult` table is visible with all expected columns including `raw`
- [ ] In a test or scratch file, validate a sample weather query plan object against `WeatherQueryPlan` — it passes
- [ ] Validate a plan with `date_from` after `date_to` — it fails validation as expected
- [ ] Confirm `VizHint` in schemas accepts `"dashboard"` and rejects unrecognised values
- [ ] Start the orchestrator with `npm run dev` — the weather `DomainConfig` entry loads without a Zod validation error
- [ ] In a test, call `getDomainForQuery` with `intent: "weather"` and `country_code: "FR"` — confirm it resolves to the weather domain (global `countries: []` rule applies)
- [ ] In a test, call `deriveVizHint` with a weather intent — confirm it returns `"dashboard"` regardless of date range

**Git**
- [ ] `git add .`
- [ ] `git commit -m "feat: schemas weather — WeatherResult model, WeatherQueryPlan, dashboard viz hint"`
- [ ] `git push origin feat/schemas-weather`
- [ ] Open pull request → merge → delete branch
- [ ] Checkout main and pull latest

---

### Step 9 — Weather adapter

**Branch**
- [ ] Checkout main and pull latest
- [ ] Create branch `feat/adapter-weather`

**Tasks**
- [ ] Add `OPENWEATHER_API_KEY` to the orchestrator `.env` file — obtain a key from OpenWeatherMap if not already done. Add the variable name (without value) to `.env.example`
- [ ] Create `apps/orchestrator/src/providers/rest-provider.ts` — a general-purpose HTTP transport wrapper with retry on 5xx (up to 3 attempts with exponential backoff), 10-second request timeout, and structured error logging. This file must not import anything from a domain — it is transport only
- [ ] Create `apps/orchestrator/src/domains/weather.ts` — the `WeatherAdapter`. It reads `OPENWEATHER_API_KEY` from `process.env` and uses `RestProvider` to fetch daily historical weather data from the OpenWeatherMap API for each day in the date range. Days are fetched in parallel capped at 5 concurrent requests using `p-limit` (the same library installed in Step 2). The `flattenRow` method maps OpenWeatherMap's nested response to the flat `WeatherResult` shape
- [ ] Implement `recoverFromEmpty` on the weather adapter with a single strategy: if the requested date range is entirely in the future, retry with today's date as both `date_from` and `date_to` and populate `FallbackInfo` accordingly
- [ ] Add the weather adapter to `apps/orchestrator/src/domains/registry.ts`
- [ ] In `apps/orchestrator/src/index.ts`, call `loadAvailability` for the weather source with an empty months extractor — OpenWeatherMap does not publish an availability list, so `isMonthAvailable` returns `true` by default, which is the correct behaviour
- [ ] Add a startup check: if `OPENWEATHER_API_KEY` is not set, log a structured error and ensure weather queries return a clear structured error response rather than crashing
- [ ] Write unit tests in `apps/orchestrator/src/__tests__/weather-adapter.test.ts` covering: successful fetch returns rows with expected fields, date fallback fires for a future date range, missing API key returns a structured error not a crash, a query with `country_code: "US"` routes to the weather adapter
- [ ] Run `npm test --workspace=apps/orchestrator` and confirm all tests pass
- [ ] Run `npm run dev` and confirm the orchestrator starts cleanly

**Test expectations**
- [ ] Query `"What was the weather in Edinburgh last week?"` — confirm it parses to `intent: "weather"` and `viz_hint: "dashboard"`
- [ ] Confirm the adapter returns at least one result row for a valid historical date in a known city
- [ ] Open Prisma Studio — `WeatherResult` rows are present with `temperature_max`, `temperature_min`, `precipitation`, and `description` populated
- [ ] Confirm the `raw` field on each row contains the full OpenWeatherMap response as JSONB
- [ ] Run a query for a date range entirely in the future — confirm the response includes a `FallbackBanner` and `resultContext.fallback.field` is `"date"`
- [ ] Run a weather query with `country_code: "US"` — confirm it routes correctly to the weather adapter
- [ ] Remove `OPENWEATHER_API_KEY` from `.env` temporarily — confirm the orchestrator logs a clear startup error and weather queries return a structured error response with HTTP status, not an unhandled crash. Restore the key afterwards
- [ ] Confirm server logs for a weather query include `domain: "weather"` and `viz_hint: "dashboard"`
- [ ] Run `npm test --workspace=apps/orchestrator` — all weather adapter unit tests pass

**Git**
- [ ] `git add .`
- [ ] `git commit -m "feat: adapter weather — WeatherAdapter with RestProvider and date fallback"`
- [ ] `git push origin feat/adapter-weather`
- [ ] Open pull request → merge → delete branch
- [ ] Checkout main and pull latest

---

### Step 10 — Weather dashboard with d3

**Branch**
- [ ] Checkout main and pull latest
- [ ] Create branch `feat/dashboard-weather`

**Tasks — dependencies**
- [ ] Install the following d3 modules as dependencies in the frontend workspace only — do not install the full d3 bundle:
  - `d3-scale` — linear, time, and band scales
  - `d3-shape` — area and line generators
  - `d3-axis` — axis generators
  - `d3-selection` — DOM selection and data binding
  - `d3-time-format` — date formatting for axis tick labels
- [ ] Install corresponding `@types/d3-*` packages for each module as dev dependencies in the frontend workspace

**Tasks — MetricCards component**
- [ ] Create `apps/frontend/src/components/MetricCards.tsx`
- [ ] The component receives the array of `WeatherResult` rows and renders four summary cards: average high temperature, average low temperature, total precipitation in millimetres, and the most common weather description across the period
- [ ] All values are computed from the result rows in the component — no additional API call
- [ ] Cards render for both single-day and multi-day results

**Tasks — TemperatureBandChart component**
- [ ] Create `apps/frontend/src/components/TemperatureBandChart.tsx`
- [ ] The component receives the `WeatherResult` rows and a shared x scale (see below)
- [ ] Uses `d3-shape` area generator to draw a filled band between `temperature_max` and `temperature_min` for each day, with a warm tint fill
- [ ] Uses `d3-shape` line generator to draw a midpoint line through the band
- [ ] Uses `d3-axis` and `d3-scale` for the x axis (time-based, shared scale) and y axis (linear, degrees Celsius)
- [ ] x axis tick labels use `d3-time-format`: day-of-month labels for ranges under 14 days, week labels for longer ranges
- [ ] On mouse hover over any day column, shows a tooltip with exact high, low, and mean temperature for that day
- [ ] Fixed height of 220px; width matches the container's rendered width measured after mount using `d3-selection`
- [ ] Only renders for multi-day results — component returns null for a single-day result set

**Tasks — PrecipitationBarChart component**
- [ ] Create `apps/frontend/src/components/PrecipitationBarChart.tsx`
- [ ] The component receives the `WeatherResult` rows and the same shared x scale as `TemperatureBandChart`
- [ ] Uses `d3-scale` band scale for bar positioning and `d3-shape` for bar rendering
- [ ] One bar per day, height proportional to `precipitation` in millimetres, with a cool tint fill
- [ ] Days with zero precipitation render as a minimal baseline bar so the axis remains readable
- [ ] Uses `d3-axis` for the y axis (linear, millimetres); x axis uses the shared scale for visual alignment with the temperature chart
- [ ] Fixed height of 140px; width matches the container width
- [ ] Only renders for multi-day results — component returns null for a single-day result set

**Tasks — DashboardView component**
- [ ] Create `apps/frontend/src/components/DashboardView.tsx`
- [ ] The component receives the `WeatherResult` rows and the `ParsedQuery` plan
- [ ] Compute the shared x scale once from the full date range using `d3-scale` time scale; pass this scale as a prop to both chart components to guarantee visual alignment between the temperature and precipitation charts
- [ ] Render layout: `MetricCards` row at the top, then `TemperatureBandChart`, then `PrecipitationBarChart`
- [ ] For a single-day result, render `MetricCards` only — do not render either chart
- [ ] Add a "Download CSV" button below the dashboard that uses the `GET /query/:id/export?format=csv` endpoint from Step 6. Do not offer GeoJSON download — weather data does not have a meaningful spatial representation
- [ ] The `FallbackBanner` and `FollowUpChips` components render above and below `DashboardView` exactly as they do for crime results — no special casing needed

**Tasks — ResultRenderer update**
- [ ] In `ResultRenderer`, add a branch: when `result.viz_hint === "dashboard"`, render `DashboardView`. All other branches (`MapView`, `BarChart`, `TableView`) remain exactly as before
- [ ] This is the only change to `ResultRenderer`

**Tasks — tests**
- [ ] Write unit tests in `apps/orchestrator/src/__tests__/dashboard.test.ts` (or frontend test equivalent) covering: `DashboardView` renders for `viz_hint: "dashboard"`, metric card values match manual calculation from result rows, single-day result renders cards only with no charts, temperature and precipitation charts share the same x scale, zero-precipitation days render a visible minimal bar

**Test expectations**
- [ ] Query `"weather in Bristol last week"` — confirm `DashboardView` renders and `MapView` does not
- [ ] Confirm the temperature band chart renders one filled band per day with height proportional to the high/low difference
- [ ] Confirm the precipitation bar chart renders one bar per day aligned to the same x positions as the temperature chart
- [ ] Confirm the four metric cards show values that match manual calculation from the result rows
- [ ] Hover over a day in the temperature chart — confirm the tooltip shows correct high, low, and mean for that day
- [ ] Run a single-day weather query — confirm only metric cards render, no SVG charts
- [ ] Confirm a day with zero precipitation renders a visible minimal bar rather than an invisible element
- [ ] Click "Download CSV" on a dashboard result — confirm the file downloads
- [ ] Confirm no "Download GeoJSON" button appears on a weather dashboard result
- [ ] Resize the browser window — confirm both charts resize to fill the available container width
- [ ] Run a crime query after implementing this step — confirm `MapView` renders as before with no regression
- [ ] Run `npm test` — all dashboard unit tests pass

**Git**
- [ ] `git add .`
- [ ] `git commit -m "feat: dashboard weather — DashboardView with d3 temperature band and precipitation charts"`
- [ ] `git push origin feat/dashboard-weather`
- [ ] Open pull request → merge → delete branch
- [ ] Checkout main and pull latest

---

### Step 11 — LLM result summaries

**Branch**
- [ ] Checkout main and pull latest
- [ ] Create branch `feat/llm-summaries`

**Tasks — orchestrator**
- [ ] Add `summary: string | null` to `ExecuteResult` in `packages/schemas/src/index.ts`
- [ ] Add `summary_ms Int?` to the `QueryJob` model in `packages/database/prisma/schema.prisma`
- [ ] Run `npm run db:migrate` to apply the migration
- [ ] Run `npm run db:generate` to regenerate the Prisma client
- [ ] Run `npm run build --workspace=packages/schemas` to confirm the schema update compiles cleanly
- [ ] Create `apps/orchestrator/src/summariser.ts`
- [ ] The module accepts: domain name, query plan, result count, and a condensed data representation — for crime results this is total count, category, location, and date range; for weather results this is the period temperature range, total precipitation, and dominant description. It does not receive raw result rows
- [ ] The module calls DeepSeek with a prompt that instructs the LLM to write a 2–3 sentence factual summary, reference numbers where possible, note any fallback that was applied, and avoid speculation about causes
- [ ] In `query.ts`, call `summariser.generateSummary` after `resultContext` is built. Wrap the call so that any failure — API error, timeout, or unexpected response shape — sets `summary` to `null` and logs the error without throwing. The execute response must return HTTP 200 regardless of whether summarisation succeeded
- [ ] Record the duration of the summarisation call in `summary_ms` on the `QueryJob` row
- [ ] Update `QueryCache` writes to include the `summary` string alongside the result — repeat identical queries return the cached summary without a new LLM call
- [ ] Do not call `summariser.generateSummary` when `result.count === 0` — set `summary: null` directly for empty results
- [ ] Write unit tests in `apps/orchestrator/src/__tests__/summariser.test.ts` covering: summary is a non-null string on a successful call, summary is null when the LLM call times out and the execute response still returns 200, summariser is not called when result count is zero, cached repeat query returns the same summary string without a new LLM call

**Tasks — frontend**
- [ ] In `App.tsx`, update the `ExecuteResult` interface to include `summary: string | null`
- [ ] In the render section, add a `summary` paragraph below `InterpretationBanner` and above the visualisation component — use a muted style that visually distinguishes it from the interpretation banner
- [ ] If `summary` is null, render nothing — no placeholder text, no skeleton, no empty element

**Test expectations**
- [ ] Run a successful crime query — confirm `summary` is a non-null string in the execute response referencing the crime category and location
- [ ] Run a successful weather query — confirm `summary` references the temperature range and precipitation total
- [ ] Temporarily point the summariser at an invalid endpoint to simulate a timeout — confirm the execute response still returns HTTP 200 with `summary: null` and no error is shown in the UI. Restore the correct endpoint afterwards
- [ ] Run any query that returns zero results — confirm `summary` is null and the summariser was not called (check server logs for absence of a `summary_ms` entry)
- [ ] Run any query twice — confirm the second response returns the same `summary` string and the second `QueryJob` row has no `summary_ms` value (no new LLM call was made)
- [ ] Confirm a fallback result's summary acknowledges the substitution — e.g. it mentions the latest available month was shown rather than the one requested
- [ ] Confirm the summary paragraph does not appear in the UI for empty or error states
- [ ] Open Prisma Studio — `QueryJob` rows for summarised queries have `summary_ms` populated; rows for cache hits do not
- [ ] Run `npm test --workspace=apps/orchestrator` — all summariser unit tests pass

**Git**
- [ ] `git add .`
- [ ] `git commit -m "feat: llm summaries — post-execution DeepSeek summarisation with caching"`
- [ ] `git push origin feat/llm-summaries`
- [ ] Open pull request → merge → delete branch
- [ ] Checkout main and pull latest

---

## Final checks

- [ ] Run `npm run test:coverage --workspace=apps/orchestrator`
- [ ] Confirm line coverage is above 80%
- [ ] Confirm branch coverage is above 70%
- [ ] Run `npm run dev` and confirm the full app starts cleanly with no errors
- [ ] Run the full manual testing checklist below before tagging the release

---

## Manual Testing Checklist

### Phase 1

| Scenario | Expected behaviour |
|---|---|
| Run 20 rapid queries | No Postgres connection errors; `pg_stat_activity` stays bounded |
| 6-month range query | Completes in under half the time of the v5.1 sequential implementation |
| Repeat a weather query within 1 hour | Cache hit returned instantly |
| Repeat a weather query after 61 minutes | Cache miss; fresh data fetched; stale row evicted from `QueryCache` |
| Crime query cache after 24 hours | Still a cache hit — `cacheTtlHours: null` never expires |

### Phase 2

| Scenario | Expected behaviour |
|---|---|
| Map query for a busy city area | Response contains fewer than 500 objects; `aggregated: true` in response |
| Bar chart query for same area | Raw monthly counts returned; `aggregated: false` |
| Click "Download CSV" on a crime result | File downloads without page navigation; row count matches Prisma Studio |
| Click "Download GeoJSON" on a crime result | Valid GeoJSON file; coordinates in `[lon, lat]` order |
| Download button on empty result | No download buttons visible |

### Phase 3

| Scenario | Expected behaviour |
|---|---|
| `"weather in Edinburgh last week"` | `DashboardView` renders; metric cards, temperature band, and precipitation chart all visible |
| Single-day weather query | Metric cards only render; no SVG charts |
| Weather query for a future date | Date fallback applied; `FallbackBanner` shown; summary notes the substitution |
| `"burglaries in Cambridge in January 2024"` | Crime result renders as before; `DashboardView` does not appear |
| Any successful query | Summary paragraph appears below the interpretation banner |
| DeepSeek summarisation timeout | Execute response returns HTTP 200; `summary: null`; no error shown |
| Repeat any query | Same summary returned; no second LLM call made |
| Missing `OPENWEATHER_API_KEY` | Clear startup log error; weather queries return structured error, not a crash |

---

## Useful Commands

| Action | Command |
|---|---|
| Start database | `docker compose up -d` |
| Stop database | `docker compose down` |
| Run tests | `npm test --workspace=apps/orchestrator` |
| Run coverage | `npm run test:coverage --workspace=apps/orchestrator` |
| Run dev | `npm run dev` |
| Prisma Studio | `npm run db:studio` |
| New migration | `npm run db:migrate` |
| Regenerate Prisma client | `npm run db:generate` |
| Reset database (dev only) | `npx prisma migrate reset --workspace=packages/database` |
| Build shared schemas | `npm run build --workspace=packages/schemas` |
| Check connection pool | `docker exec -it dredge-postgres-1 psql -U postgres -d dredge -c "SELECT count(*) FROM pg_stat_activity;"` |
