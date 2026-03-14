# DREDGE v6.0 — Data Intelligence Platform

---

## Overview

v6.0 transforms DREDGE from a single-domain query tool into a multi-source data intelligence platform. Four capabilities are delivered across three phases: infrastructure hardening, spatial aggregation for visualisation and export, a second domain (weather) with its own dedicated dashboard visualisation, and LLM-generated result summaries.

Each phase is independently deployable and builds on the additive, domain-agnostic architecture established in v4.1 and v5.1. Nothing in v5.1 is removed. All changes are additive except where explicitly noted.

**What this version is not.** v6.0 does not combine datasets from multiple domains into a single visualisation. Each query resolves to exactly one domain, one result set, and one visualisation. Weather and crime remain entirely separate — a weather query produces a weather dashboard, a crime query produces a map or chart. v6.0 does not introduce Redis, a message broker, or pgvector.

---

## What Changes for the User

### Before (v5.1)
- Single domain: UK crime data only
- Multi-month queries are slow — months fetched sequentially
- Maps render individual scatter points regardless of result volume
- No way to take data outside the app
- Results presented as raw data with no interpretive layer

### After (v6.0)
- Multi-month queries run in parallel — noticeably faster for any date range
- Heatmap and cluster views use pre-aggregated spatial bins — large result sets no longer cause a performance cliff
- Results downloadable as CSV or GeoJSON with a single click
- Weather domain available: *"What was the weather in Bristol last week?"*
- Weather queries produce a dedicated d3 dashboard: temperature band chart, precipitation bar chart, and summary metric cards
- A plain-English summary paragraph appears beneath every result

---

## What Does Not Change

- The parse → execute pipeline structure is unchanged
- The `DomainAdapter` interface gains new optional fields but all existing adapters remain valid without modification
- The `QueryJob`, `QueryCache`, and `GeocoderCache` tables are unchanged in structure
- The fallback and recovery system from v5.1 is unchanged
- The follow-up chip system from v5.1 is unchanged
- Frontend visualisation modes for crime (points, clusters, heatmap) are unchanged — aggregation affects what data they receive, not how they render

---

## Architecture Principles Added in v6.0

### Provider / Adapter Split

In v5.1, each adapter handles both domain logic (what the data means) and transport logic (how to fetch it). As sources diversify these concerns are separated into two layers.

**Providers** are low-level transport utilities, reusable across any domain. A provider knows how to make an HTTP request, parse a CSV, or scrape a page — but knows nothing about crime or weather.

**Adapters** remain the domain experts. They know what fields mean, how to flatten a row, and what recovery strategies apply. An adapter calls a provider for the raw fetch then applies its own logic to the result.

When a second domain also needs REST HTTP fetching it calls the same `RestProvider` rather than duplicating Axios configuration. Future source types — CSV files, scraped pages — require only a new provider, with no changes to existing adapters.

### Viz-Hint-Driven Rendering

The `viz_hint` field established in v4.1 gains a new value in v6.0: `"dashboard"`. The routing rules are:

- Any weather query → `"dashboard"`
- Single month, single location crime query → `"map"`
- Multi-month crime query → `"bar"`
- Explicit list phrasing → `"table"`

The frontend inspects `viz_hint` and renders the appropriate component. `DashboardView` is new in v6.0. All other rendering paths are unchanged. No domain adapter decides which component renders — that remains a deterministic derivation in `deriveVizHint`, which now accounts for domain as an input alongside query shape.

### Domain Config Extensions

Two new optional fields are added to `DomainConfig`:

- `cacheTtlHours: number | null` — how long a cached result remains valid. `null` means the cache never expires, appropriate for historical data. Real-time domains like weather use a short TTL.
- `rateLimit: { requestsPerMinute: number }` — maximum external requests per minute for this adapter. The orchestrator enforces this before calling `fetchData`.

Both fields are optional and default to no TTL and no rate limit, so existing adapters require no changes.

---

## Phase 1 — Infrastructure Hardening

### Branch plan

Branches must be completed in order 1 → 2 → 3. Branch 4 can follow in any order after 3 is merged.

```
infra/connection-pooling     ← Step 1
infra/parallel-fetch         ← Step 2
infra/rate-limiting          ← Step 3
infra/cache-ttl              ← Step 4
```

---

### Step 1 — Connection pooling

**Goal:** Prevent Postgres connection exhaustion when parallel fetches open multiple simultaneous Prisma connections.

**What to do:**

- Decide between PgBouncer in transaction mode (external process added to Docker Compose) or Prisma's built-in `connection_limit` parameter on the database URL
- If using PgBouncer: add it as a service in `docker-compose.yml`, configure it to point at the Postgres service, and update `DATABASE_URL` in the orchestrator to connect via the bouncer port
- If using Prisma's built-in limit: add `connection_limit` and `pool_timeout` parameters to the `DATABASE_URL` string
- Set the pool size to a value that leaves headroom for admin connections — 10 is a sensible starting point for development
- Confirm the pool is being reused across requests by checking that Postgres `pg_stat_activity` does not grow unboundedly under repeated queries

**Test expectations:**

- Running 20 rapid sequential queries does not produce a "too many clients" error from Postgres
- `pg_stat_activity` shows a stable, bounded number of active connections that does not increase with query volume
- Query latency is not measurably worse than before pooling was introduced
- Prisma Studio continues to connect alongside the orchestrator without connection errors

---

### Step 2 — Parallel month fetching

**Goal:** Fetch all months in a date range concurrently rather than sequentially, significantly reducing latency for multi-month queries.

**What to do:**

- In the crime adapter's `fetchData` method, identify the loop that iterates over months and calls the Police API once per month
- Replace the sequential loop with concurrent fetching using `Promise.all`, wrapped with `p-limit` to cap concurrent requests at 3 — this respects the Police API's tolerance without overwhelming it
- The result is a flat array of all crime records across all months, identical in shape to what the sequential loop produced
- No changes are needed in `query.ts`, the registry, or any schema — the adapter's public interface is unchanged
- Add `p-limit` as a dependency in the orchestrator workspace

**Test expectations:**

- A query spanning 6 months completes in under half the time of the same query before this change
- The total number of results returned for a multi-month query is identical to what the sequential implementation returned for the same inputs
- A single-month query behaves identically to before — no regression
- Server logs show fetch activity overlapping in time rather than in strict sequence
- If the Police API returns an error for one month, the other months still return successfully — the failing month is skipped rather than crashing the entire fetch

---

### Step 3 — Per-adapter rate limiting

**Goal:** Prevent the orchestrator from overwhelming external APIs, especially under parallel fetch conditions.

**What to do:**

- Add an optional `rateLimit: { requestsPerMinute: number }` field to `DomainConfig` in `@dredge/schemas`
- Create a `rateLimiter.ts` module in the orchestrator implementing a token bucket per adapter name — tokens refill at the rate specified in the config
- Before `adapter.fetchData` is called in `query.ts`, check the token bucket for that adapter. If a token is available, consume it and proceed. If not, wait until one becomes available — queue, do not reject
- Set the crime-uk config to 30 requests per minute as a conservative starting point
- Rate limiter state is in-memory and resets on server restart — acceptable for v6.0

**Test expectations:**

- A query triggering 12 parallel month fetches does not send all 12 requests simultaneously — requests are spaced according to the configured rate
- The rate limiter does not drop requests — all months eventually complete with controlled spacing
- A domain with no `rateLimit` field configured passes through without delay
- Server logs show measurable gaps between request timestamps when the rate limit is active
- A cache hit bypasses the rate limiter entirely — no delay on repeated queries

---

### Step 4 — Cache TTL policy

**Goal:** Allow domains with volatile data to expire cached results, while preserving indefinite caching for historical data.

**What to do:**

- Add an optional `cacheTtlHours: number | null` field to `DomainConfig` in `@dredge/schemas`
- In the `QueryCache` lookup inside `query.ts`, after a cache hit is found, check whether `adapter.config.cacheTtlHours` is set. If it is, compare `QueryCache.createdAt` against the current time. If the cache entry is older than the TTL, treat it as a miss and proceed to live execution
- When a stale cache entry is encountered, delete it before writing the fresh result to avoid duplicate rows on the same hash
- Set `cacheTtlHours: null` on the crime-uk config — historical data never expires
- The weather domain config added in Phase 3 will use `cacheTtlHours: 1`

**Test expectations:**

- A cache entry for crime-uk is still returned as a hit 24 hours after creation
- A cache entry for a domain with `cacheTtlHours: 1` is treated as a miss after 61 minutes
- When a stale cache hit is detected, the server log shows `cache_hit: false` and `stale_cache_evicted: true`
- A fresh cache entry written after a stale eviction is returned as a hit on the very next identical query
- Prisma Studio: the `QueryCache` table does not accumulate duplicate rows for the same hash after stale evictions

---

## Phase 2 — Spatial Aggregation and Export

### Branch plan

Branches 1 and 2 can be done in either order. Branch 3 must follow both.

```
feat/spatial-aggregation     ← Step 5
feat/export-endpoints        ← Step 6
feat/frontend-v6-data        ← Step 7
```

---

### Step 5 — Spatial aggregation

**Goal:** When the viz hint is `map` or `heatmap`, return pre-aggregated spatial bins rather than raw rows. This keeps map payloads small regardless of result count and eliminates the performance cliff that large queries currently cause in the frontend.

**What to do:**

- After `adapter.storeResults` writes rows to Postgres in `query.ts`, branch on `viz_hint`
- For `viz_hint` of `map` or `heatmap`: instead of calling `findMany` for raw rows, run a PostGIS aggregation query against the result table. The query groups points into a grid using `ST_SnapToGrid`, returning one row per cell containing the cell centroid coordinates and the count of incidents within it. A grid resolution of approximately 200 metres is a sensible default for city-level queries
- For `viz_hint` of `bar` or `table`: continue returning raw rows as before — the dataset is small enough that aggregation adds no value
- For `viz_hint` of `dashboard`: the weather adapter handles its own response shape — see Step 10
- The aggregated response uses a distinct shape: an array of objects with `lat`, `lon`, and `count` fields. Add an `aggregated: boolean` flag to the execute response so the frontend knows which shape it has received
- Raw rows remain in Postgres — aggregation happens at query time, not at storage time. The `QueryCache` stores the aggregated result for map and heatmap queries

**New schema additions (packages/schemas):**

- `AggregatedBin` type: `{ lat: number, lon: number, count: number }`
- `ExecuteResult` updated to accept either `results: CrimeResult[]` when `aggregated: false` or `results: AggregatedBin[]` when `aggregated: true`

**Test expectations:**

- A single-month map query for a busy area returns fewer than 500 result objects regardless of how many raw rows are stored
- Each result object in an aggregated response has `lat`, `lon`, and `count` fields and no other crime-specific fields
- The execute response includes `aggregated: true` when binning was applied
- A bar chart query for the same area returns raw monthly counts as before — `aggregated: false`
- Running the same map query twice returns identical bin coordinates on both runs — aggregation is deterministic
- Prisma Studio: raw crime rows are still present in the `CrimeResult` table after an aggregated query — source data is not lost
- The `QueryCache` entry for a map query stores the aggregated bins, not the raw rows

---

### Step 6 — Export endpoints

**Goal:** Allow users to download query results as CSV or GeoJSON, enabling use in external tools such as QGIS, Excel, or Mapbox Studio.

**What to do:**

- Add two new GET endpoints to the orchestrator:
  - `GET /query/:id/export?format=csv` — returns a CSV file attachment
  - `GET /query/:id/export?format=geojson` — returns a GeoJSON FeatureCollection attachment
- Both endpoints look up the `query_id` in the relevant result table using `findMany` with no row cap — these are full exports of the raw stored rows, not aggregated bins
- The CSV endpoint serialises all columns present in the result rows with a header row, using a streaming response to avoid memory pressure on large exports
- The GeoJSON endpoint wraps each row as a `Feature` with a `Point` geometry using the `latitude` and `longitude` fields, and all remaining fields as `properties`
- Both endpoints set `Content-Disposition: attachment` and the appropriate `Content-Type` headers so browsers trigger a file download
- If the `query_id` does not exist or has no results, the endpoint returns a 404 with a clear message
- Export endpoints bypass the rate limiter — they read from Postgres only, with no external API calls

**Test expectations:**

- `GET /query/:id/export?format=csv` returns a file download with a `.csv` extension and `Content-Type: text/csv` header
- The CSV contains a header row with column names matching the fields stored in the result table
- The CSV row count matches the number of rows in Prisma Studio for that `query_id`
- `GET /query/:id/export?format=geojson` returns valid GeoJSON — output passes GeoJSON schema validation
- Each GeoJSON feature has a `Point` geometry with coordinates in `[longitude, latitude]` order
- A request for a non-existent `query_id` returns HTTP 404
- A request with an unsupported format returns HTTP 400 with a clear error message
- Exporting a query with 1000+ rows completes without an out-of-memory error on the server
- Weather results are also exportable via the same endpoints — the format is domain-agnostic

---

### Step 7 — Frontend download button and aggregation-aware rendering

**Goal:** Surface the export functionality in the UI and handle the new aggregated response shape in the map component.

**What to do:**

- In `ResultRenderer`, add a download toolbar below the visualisation containing two buttons: "Download CSV" and "Download GeoJSON". Each triggers a direct browser download by navigating to the appropriate export endpoint URL constructed from `result.query_id`
- Update the map rendering path to inspect the `aggregated` flag on the execute response. If `aggregated: true`, pass the `AggregatedBin` array to the map component using the `count` field for point weight or heatmap intensity — deck.gl's `HeatmapLayer` accepts this shape natively. If `aggregated: false`, the existing rendering path is unchanged
- Download buttons are visible only when `result.count > 0` — no download affordance on empty states
- Download buttons do not appear on weather dashboard results — weather export is deferred to a future version

**Test expectations:**

- Download buttons appear below a crime map result with data
- Clicking "Download CSV" triggers a file download in the browser without navigating away from the app
- Clicking "Download GeoJSON" triggers a GeoJSON file download
- No download buttons appear when the result count is zero
- A map query for a large city area renders without lag — the network tab shows fewer than 500 objects in the response
- A bar chart query continues to render as before — download buttons still appear using the same `query_id`
- Switching between points, clusters, and heatmap modes on an aggregated result works correctly — all three modes accept the bin shape

---

## Phase 3 — Weather Domain, Dashboard, and Summaries

### Branch plan

Branches must be completed in order 1 → 2 → 3 → 4.

```
feat/schemas-weather         ← Step 8
feat/adapter-weather         ← Step 9
feat/dashboard-weather       ← Step 10
feat/llm-summaries           ← Step 11
```

---

### Step 8 — Weather domain schemas and config

**Goal:** Define the types, config, and Prisma model for the weather domain before writing any adapter or visualisation logic.

**What to do:**

- Add a `WeatherResult` Prisma model to `packages/database/prisma/schema.prisma`. Required fields at minimum: `id`, `query_id` (foreign key to `Query`), `date`, `latitude`, `longitude`, `temperature_max`, `temperature_min`, `precipitation`, `wind_speed`, `description`, and `raw Json?`
- Run a Prisma migration to create the `weather_results` table
- Add `"dashboard"` as a valid value to the `VizHint` union type in `@dredge/schemas` — this is the only change to the existing schema type
- Add a `WeatherQueryPlan` schema to `@dredge/schemas`. Required fields: `location`, `date_from` (YYYY-MM-DD), `date_to` (YYYY-MM-DD), and an optional `metric` field accepting values of `"temperature"`, `"precipitation"`, or `"wind"`
- Add the weather `DomainConfig` entry to the registry config file with the following key values:
  - `name: "weather"`, `tableName: "weather_results"`, `prismaModel: "weatherResult"`
  - `countries: []` — weather is globally available; empty array means any country
  - `intents: ["weather"]`
  - `cacheTtlHours: 1` — weather data is volatile
  - `rateLimit: { requestsPerMinute: 60 }` — OpenWeatherMap free tier limit
- Update `deriveVizHint` in the intent parsing logic to return `"dashboard"` whenever the resolved domain is `"weather"`, regardless of query shape

**Test expectations:**

- `npx prisma migrate dev` runs without errors and creates the `weather_results` table
- Prisma Studio shows the `WeatherResult` model with all expected columns including `raw`
- `@dredge/schemas` exports `WeatherQueryPlan` and validates correctly against a sample weather query object
- The weather `DomainConfig` entry passes Zod validation when the registry loads on server startup
- A query with intent `"weather"` and `country_code: "FR"` resolves to the weather adapter via `getDomainForQuery` — the `countries: []` global rule is correctly applied
- `deriveVizHint` returns `"dashboard"` for a weather query regardless of whether it spans one day or thirty days
- `deriveVizHint` continues to return `"map"`, `"bar"`, or `"table"` for crime queries — no regression

---

### Step 9 — Weather adapter

**Goal:** Implement the `WeatherAdapter` using OpenWeatherMap's historical weather API, following the Provider / Adapter pattern introduced in v6.0.

**What to do:**

- Create `apps/orchestrator/src/providers/rest-provider.ts` — a thin reusable wrapper around Axios handling retries on 5xx responses (up to 3 attempts with exponential backoff), a 10-second request timeout, and structured error logging. This provider has no knowledge of weather or crime — it is a generic HTTP utility
- Create `apps/orchestrator/src/domains/weather.ts` — the `WeatherAdapter`. It calls `RestProvider` to fetch daily weather data from the OpenWeatherMap historical API for each day in the date range. The adapter's `flattenRow` method maps OpenWeatherMap's nested response to the flat `WeatherResult` shape defined in Step 8
- Register `OPENWEATHER_API_KEY` as a required environment variable. The adapter reads this from `process.env` — it is never hardcoded. Document this in the project `.env.example` file
- Implement `recoverFromEmpty` on the weather adapter with a single strategy: if the requested date is in the future, retry with today's date and disclose this via `FallbackInfo`
- Add the weather adapter to `apps/orchestrator/src/domains/registry.ts`
- Add `loadAvailability` for the weather source in `index.ts`. OpenWeatherMap does not publish an availability list, so the weather source registers with an empty months array — `isMonthAvailable` returns `true` by default for all dates, which is correct behaviour

**Test expectations:**

- A query `"What was the weather in Edinburgh last week?"` parses to `intent: "weather"` and routes to the weather adapter
- The weather adapter returns at least one result row for a valid historical date in a known city
- `WeatherResult` rows are visible in Prisma Studio after a successful query with `temperature_max`, `temperature_min`, `precipitation`, and `description` populated
- The `raw` field on each row contains the full OpenWeatherMap API response as JSONB
- A query for a future date triggers the date fallback — the response includes `resultContext.fallback` with `field: "date"` and a `FallbackBanner` in the UI
- A weather query for a US city successfully routes to the weather adapter — the global domain rule is applied
- A missing `OPENWEATHER_API_KEY` causes a clear error to be logged at startup, and weather queries return a structured error rather than crashing the server
- Server logs for a weather query show `domain: "weather"` and `viz_hint: "dashboard"` in the structured JSON output
- The `cacheTtlHours: 1` policy is active — a weather query cached more than an hour ago is treated as a miss on the next identical query

---

### Step 10 — Weather dashboard with d3

**Goal:** Build a dedicated `DashboardView` component that renders weather results using focused d3 modules, providing a richer multi-metric view than a single chart type could offer.

**What to do:**

**Install d3 modules**

Add the following four d3 modules as dependencies in the frontend workspace. Install only these — do not install the full d3 bundle:

- `d3-scale` — maps data values (temperatures, dates, precipitation amounts) to pixel coordinates using linear, time, and band scales
- `d3-shape` — generates the SVG path strings for the temperature area band and any line overlays
- `d3-axis` — renders x and y axes with ticks, gridlines, and date-formatted labels directly into the SVG
- `d3-selection` — handles SVG DOM manipulation when mounting axes and updating chart elements in response to new data

These four modules cover all chart rendering needs in `DashboardView`. No other d3 modules are required.

**Dashboard layout**

`DashboardView` is a React component receiving the `WeatherResult` array and the `QueryPlan` as props. It renders four sections stacked vertically in this order:

- Summary metric cards
- Temperature band chart (multi-day queries only)
- Precipitation bar chart (multi-day queries only)
- Conditions timeline

For a single-day query only the metric cards and a single-day conditions entry are rendered — no charts.

**Summary metric cards**

Four cards arranged in a row at the top of the dashboard:

- Period average temperature — the mean of all `temperature_max` and `temperature_min` midpoints across the result set, displayed in °C
- Total precipitation — the sum of all daily `precipitation` values across the result set, displayed in mm
- Average wind speed — the mean of all `wind_speed` values, displayed in km/h
- Dominant conditions — the most frequently occurring `description` string across the result set

Cards use the existing app colour variables and card styling so they match the rest of the UI.

**Temperature band chart**

Uses `d3-scale`, `d3-shape`, and `d3-axis`.

- The x axis is a time scale spanning `date_from` to `date_to`, constructed with `d3-scale`'s `scaleTime`. Tick intervals are set via `d3-axis`: one tick per day for ranges up to 14 days, one tick per week for longer ranges. Date labels are formatted as day-month (e.g. "14 Mar")
- The y axis is a linear scale spanning from the minimum `temperature_min` value to the maximum `temperature_max` value across the entire result set, with 10% padding above and below. Labels show °C
- The temperature band is rendered as a filled SVG area using `d3-shape`'s `area` generator. The upper boundary of the area follows `temperature_max` for each day; the lower boundary follows `temperature_min`. This produces a single continuous band showing the full daily temperature range rather than two separate lines
- The band fill uses a warm amber colour at 30% opacity so gridlines remain visible through it
- A thin centre stroke is drawn through the midpoint of each day's band (the mean of `temperature_max` and `temperature_min`) to give a visual trend anchor
- Horizontal gridlines are drawn at each y axis tick using a light tertiary border colour
- Axes are constructed using `d3-axis` and mounted into the SVG via `d3-selection` within a React `useEffect`

**Precipitation bar chart**

Uses `d3-scale`, `d3-axis`, and `d3-selection`.

- The x axis uses `d3-scale`'s `scaleBand` with one band per day and the same date range as the temperature chart, so the two charts align horizontally when stacked
- The y axis is a linear scale from 0 to the maximum daily `precipitation` value, with 10% padding above. Labels show mm
- Each bar is an SVG `rect` positioned and sized using the band scale for x position and width, and the linear scale for height. No `d3-shape` is needed for a bar chart — plain SVG rects suffice
- Days with zero precipitation render a 1px minimum-height bar rather than nothing, so the x axis date grid remains complete and legible
- Bar fill uses a cool blue colour consistent with the app's existing palette

**Chart dimensions and SVG setup**

- Both charts use `width="100%"` on the SVG element with a defined `viewBox` so they scale responsively within the dashboard container without horizontal scrolling
- Both charts use the same margin convention: 20px top, 20px right, 40px bottom, 50px left. The inner plot area is inset from these margins to accommodate axis labels
- Both charts are given the same total height (240px is a sensible default) and the same x axis range so dates align visually when the two charts are stacked vertically

**Mounting strategy**

- `DashboardView` is a React component. The temperature chart and precipitation chart are each separate child components, each managing their own SVG ref via `useRef`
- `d3-scale` and `d3-shape` are used for computation only — they produce scale functions and path strings as plain values
- `d3-axis` and `d3-selection` write into the SVG DOM inside a `useEffect`. This is the only place d3 touches the DOM directly — React manages everything outside the SVG
- The `useEffect` for each chart declares the `WeatherResult` array as a dependency. When the result changes (e.g. a follow-up chip is clicked), the effect re-runs and redraws the chart cleanly
- On unmount, the effect cleanup removes all d3-rendered elements from the SVG ref to prevent stale content accumulating across result changes

**Test expectations:**

- A weather query renders `DashboardView` — the `viz_hint: "dashboard"` routing to this component is confirmed and `MapView` does not render
- The four summary metric cards display values consistent with the result set — the period average temperature, total precipitation, average wind, and dominant description are each correct
- For a single-day result, only the metric cards and conditions timeline render — no temperature band chart or precipitation bar chart appear
- For a multi-day result, both the temperature band chart and precipitation bar chart render below the metric cards
- The temperature band chart x axis shows the correct number of ticks — daily for ranges up to 14 days, weekly for longer ranges
- The filled band in the temperature chart correctly spans from `temperature_min` at the bottom to `temperature_max` at the top for each day — verify against a known result row
- The precipitation bar chart renders one bar per day with correct relative heights — the tallest bar corresponds to the day with the highest `precipitation` value
- A day with zero precipitation renders a visible minimal bar rather than a gap in the x axis
- Both charts display the same dates at the same horizontal positions when stacked — x axis alignment is confirmed visually
- `DashboardView` renders correctly at a narrow viewport width (320px) — SVG scales down without clipping axis labels or overflowing its container
- Clicking a follow-up chip replaces the dashboard content with the new result — no stale chart data or ghost SVG elements remain from the previous render
- A crime query does not render `DashboardView` — routing to `MapView` or `BarChart` is unchanged
- Download buttons from Step 7 do not appear within or below `DashboardView`

---

### Step 11 — LLM result summaries

**Goal:** Generate a plain-English summary of what the data shows using a second DeepSeek call after execution completes, for both crime and weather results.

**What to do:**

- Create `apps/orchestrator/src/summariser.ts`. This module accepts the execute result — domain name, query plan, result count, the first several rows of data, and any fallback info — and calls DeepSeek with a tightly constrained prompt
- The prompt instructs the LLM to produce exactly 2–3 sentences that state the key finding numerically where possible, reference the location and date range from the plan, note any fallback that was applied, and avoid speculation about causes or recommendations. It must not reproduce raw data rows or invent figures not present in the result
- For weather results, the summary references the temperature range, total precipitation, and dominant conditions for the period
- For crime results, the summary references the category, location, and count, with a comparison to adjacent months where the result data supports it
- Call `summariser.generateSummary` after `resultContext` is built in `query.ts`. Attach the returned string as a `summary` field on the execute response
- If summarisation fails for any reason (API error, timeout after 5 seconds), `summary` is set to `null` and the error is logged. The failure must never prevent the execute response from returning — it is a non-blocking enrichment
- Add `summary_ms Int?` to the `QueryJob` model in Prisma so the duration of the summary call is observable in the audit log
- Cache the summary alongside the query result in `QueryCache` — repeated identical queries do not trigger a second LLM call
- In the frontend, render the `summary` string as a short paragraph below the `InterpretationBanner` and above the visualisation in a muted style distinguishing it from the interpretation text. If `summary` is null, nothing is rendered — no placeholder or loading state

**New Prisma field on QueryJob:**

- `summary_ms Int?` — duration of the summarisation call in milliseconds

**New field on ExecuteResult in schemas:**

- `summary: string | null`

**Test expectations:**

- A successful crime query returns a non-null `summary` containing a short paragraph referencing the crime category and location from the plan
- A successful weather query returns a non-null `summary` referencing the location, date range, and temperature or precipitation figures from the result
- A cache hit on a repeat query returns the same `summary` string without triggering a new LLM call — `summary_ms` is absent from the second `QueryJob` row
- If the DeepSeek summarisation call times out, the execute response still returns HTTP 200 with `summary: null` — the timeout does not produce a 500 error
- Server logs show `summary_ms` in the structured JSON output for non-cached queries
- An empty result returns `summary: null` — the summariser is not called when there is nothing to summarise
- The summary paragraph does not appear in the UI for empty or error states
- The summary paragraph appears in both the crime result view and below the weather dashboard metric cards
- Prisma Studio: the `QueryJob` table shows `summary_ms` populated for successful non-cached queries

---

## New Prisma Models and Fields

### WeatherResult — added in Step 8

Fields required: `id`, `query_id` (relation to Query), `date`, `latitude`, `longitude`, `temperature_max`, `temperature_min`, `precipitation`, `wind_speed`, `description`, `raw Json?`. Table name: `weather_results`.

### QueryJob additions — added in Step 11

- `summary_ms Int?` — duration of the post-execution summarisation call in milliseconds

---

## New and Updated Schema Types

### New in Step 5

`AggregatedBin` — `{ lat: number, lon: number, count: number }`. Used in execute responses when `viz_hint` is `map` or `heatmap`.

### New in Step 8

`WeatherQueryPlan` — fields: `location: string`, `date_from: string (YYYY-MM-DD)`, `date_to: string (YYYY-MM-DD)`, `metric: "temperature" | "precipitation" | "wind" | undefined`.

`VizHint` — extended with `"dashboard"` as a valid value. Existing values unchanged.

### Updated in Steps 5 and 11

`ExecuteResult` gains:

- `aggregated: boolean` — whether `results` contains raw rows or aggregated bins
- `summary: string | null` — LLM-generated plain-English summary

---

## Branch Plan (Full Sequence)

```
Phase 1 — Infrastructure
  infra/connection-pooling     ← Step 1
  infra/parallel-fetch         ← Step 2
  infra/rate-limiting          ← Step 3
  infra/cache-ttl              ← Step 4

Phase 2 — Aggregation and Export
  feat/spatial-aggregation     ← Step 5
  feat/export-endpoints        ← Step 6
  feat/frontend-v6-data        ← Step 7

Phase 3 — Intelligence
  feat/schemas-weather         ← Step 8
  feat/adapter-weather         ← Step 9
  feat/dashboard-weather       ← Step 10
  feat/llm-summaries           ← Step 11
```

### Commit messages

```
infra: connection pooling — PgBouncer or Prisma pool config
infra: parallel month fetching — p-limit concurrency cap on crime adapter
infra/rate-limiting — token bucket per adapter via DomainConfig
infra: cache TTL — expiry policy on QueryCache with stale eviction

feat: spatial aggregation — PostGIS binning for map and heatmap viz hints
feat: export endpoints — CSV and GeoJSON download via query ID
feat: frontend v6 data — download buttons and aggregation-aware map rendering

feat: schemas weather — WeatherResult model, WeatherQueryPlan, dashboard viz hint
feat: adapter weather — WeatherAdapter with RestProvider and date fallback
feat: dashboard weather — DashboardView with d3 temperature band and precipitation charts
feat: llm summaries — post-execution DeepSeek summarisation with caching
```

---

## Manual Testing Checklist

### Phase 1

| Scenario | Expected behaviour |
|---|---|
| Run 20 rapid queries | No Postgres connection errors; `pg_stat_activity` stays bounded |
| Query spanning 6 months | Completes in under half the time of the sequential implementation |
| Repeat a weather query within 1 hour | Cache hit returned instantly |
| Repeat a weather query after 61 minutes | Cache miss, fresh data fetched, stale row evicted |
| Crime query cache hit after 24 hours | Still a cache hit — `cacheTtlHours: null` never expires |

### Phase 2

| Scenario | Expected behaviour |
|---|---|
| Map query for a busy city area | Response contains fewer than 500 objects; `aggregated: true` in response |
| Bar chart query for same area | Raw monthly counts returned; `aggregated: false` |
| Click "Download CSV" on a crime result | File downloads without page navigation; row count matches Prisma Studio |
| Click "Download GeoJSON" on a crime result | Valid GeoJSON downloads; coordinates in `[lon, lat]` order |
| Download button on empty result | No download buttons visible |

### Phase 3

| Scenario | Expected behaviour |
|---|---|
| `"weather in Edinburgh last week"` | DashboardView renders; metric cards, temperature band, and precipitation chart all visible |
| Single-day weather query | Only metric cards and conditions timeline render — no charts |
| Weather query for a future date | Date fallback applied; FallbackBanner shown; summary notes the substitution |
| `"burglaries in Cambridge in January 2024"` | Crime result renders as before; DashboardView does not appear |
| Any successful query | `summary` paragraph appears below the interpretation banner |
| DeepSeek summarisation timeout | Execute response returns HTTP 200; `summary: null`; no error shown to user |
| Repeat any query | Same `summary` returned; no second LLM call made |
| Missing `OPENWEATHER_API_KEY` | Clear error at startup; weather queries return structured error, not a crash |

---

## Coverage Check

```
npm run test:coverage --workspace=apps/orchestrator
```

- All tests passing
- Line coverage above 80%
- Branch coverage above 70%

New test files to write:

- `__tests__/rate-limiter.test.ts` — token bucket behaviour, request queuing under load, bypass on cache hit
- `__tests__/cache-ttl.test.ts` — TTL expiry, stale eviction, null TTL never expires
- `__tests__/aggregation.test.ts` — bin count within expected range, bin shape, viz hint routing
- `__tests__/export.test.ts` — CSV structure, GeoJSON validity, 404 on missing query, 400 on bad format
- `__tests__/weather-adapter.test.ts` — successful fetch, date fallback, missing API key handling, global country routing
- `__tests__/summariser.test.ts` — summary present on success, null on timeout, not called on empty result, cached on repeat

---

## Architecture Summary

```
User text
  └─ POST /query/parse
       └─ parseIntent() — resolves single intent
       └─ geocoder — GeocoderCache → Nominatim + PostGIS
       └─ deriveVizHint() — accounts for domain; returns "dashboard" for weather
       └─ Returns plan, poly, viz_hint, resolved_location, country_code, intent, months

  └─ POST /query/execute
       └─ getDomainForQuery() — resolves single adapter
       └─ QueryCache lookup (TTL-aware)
            Cache hit → return stored result + cached summary, done
       └─ RateLimiter.acquire() for adapter
       └─ adapter.fetchData() via RestProvider
       └─ adapter.recoverFromEmpty() if needed (adapter-owned)
       └─ evolveSchema()
       └─ adapter.storeResults()
       └─ Branch on viz_hint:
            map / heatmap → PostGIS aggregation → AggregatedBin array
            bar / table   → findMany raw rows
            dashboard     → findMany WeatherResult rows
       └─ generateFollowUps() (domain-aware)
       └─ summariser.generateSummary() — non-blocking DeepSeek call
       └─ QueryCache write (result + summary)
       └─ QueryJob update (timings, summary_ms, fallback fields)
       └─ Structured JSON log
       └─ Returns result, resultContext, aggregated flag, summary

  Frontend
       └─ InterpretationBanner — plan, cached badge
       └─ LLM Summary paragraph (if present)
       └─ FallbackBanner (if fallback applied)
       └─ ResultRenderer — routes on viz_hint:
            map / heatmap → MapView (aggregation-aware, deck.gl)
            bar           → BarChart
            table         → TableView
            dashboard     → DashboardView (d3 modules)
                             ├─ Metric cards (all queries)
                             ├─ Temperature band chart (multi-day only)
                             ├─ Precipitation bar chart (multi-day only)
                             └─ Conditions timeline (all queries)
       └─ Download toolbar — CSV, GeoJSON (crime results only in v6.0)
       └─ FollowUpChips
       └─ EmptyResults with chips (if count is zero)
```

**Key principles carried forward from v5.1:**

- `query.ts` remains domain-agnostic — it calls adapter hooks, it does not contain domain logic
- The LLM extracts intent only — it never produces coordinates, viz hints, schema mappings, or fabricated summaries
- Adding a new domain requires only a config entry, a Prisma model, an adapter file, and a registry registration — no existing files change
- Every result table retains a `raw Json?` column — no data is ever lost regardless of schema state
- Failures in non-critical paths (summarisation) never propagate to the core execute response
- One query resolves to one domain, one result set, and one visualisation — datasets are never combined

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
| Inspect query jobs | `npm run db:studio` → QueryJob table |
| Inspect weather results | `npm run db:studio` → WeatherResult table |
| Inspect query cache | `npm run db:studio` → QueryCache table |
