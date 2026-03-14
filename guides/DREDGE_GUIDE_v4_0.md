# dredge — implementation guide v4.0

---

## what changed from v3.2

- **single-step query flow** — `POST /query/parse` and `POST /query/execute` are called back-to-back automatically; the frontend no longer blocks on a confirmation step. The interpreted plan is shown as a banner above results with a "Refine ↩" link
- **PostGIS for polygon generation** — bounding boxes from Nominatim are replaced with a 5km radius PostGIS polygon centred on the geocoded point; eliminates Police API 404s caused by oversized bounding boxes
- **`country_code` returned from geocoder** — Nominatim already provides this; exposing it enables domain routing without a separate lookup
- **domain routing layer** — `src/domains/registry.ts` maps country codes and intent to the correct adapter; adding a new domain is a single registry entry
- **config-driven domain adapters** — each domain is described by a `DomainConfig` JSON object specifying API URL, auth, location style, and a field path map for flattening; no bespoke TypeScript per domain for simple REST APIs
- **`query.ts` routes through registry** — classify intent → look up domain → call adapter; crime-UK is the first registered adapter
- **stored rows returned from execute** — `POST /query/execute` now fetches flattened rows from the database after storing and returns those, so `latitude` and `longitude` are always top-level numbers on the frontend
- **real map rendering** — `MapComponent` uses MapLibre + deck.gl with three modes: points, clusters, heatmap; replaces placeholder grid

---

## what changed from v3.1 (carried forward from v3.2)

- **crime pipeline in subdirectory** — `src/crime/` rather than flat `src/`
- **schema evolution is table-name aware** — `evolveSchema` accepts `tableName`
- **`domain` field on `Query` and `SchemaVersion` models** — defaults to `"crime"`
- **`geocodeToCoordinates` exported** — required by all non-polygon domains
- **`CoordinatesSchema` in shared schemas** — validates `{ lat, lon }`
- **date ranges** — `date_from` / `date_to` replacing single `date`
- **deterministic viz hint** — derived after parsing, never from LLM
- **structured intent errors** — `{ error, understood, missing, message }`

---

## prerequisites

- [ ] Node 20+ installed
- [ ] Docker Desktop installed and running
- [ ] DeepSeek API key obtained
- [ ] GitHub repository created and cloned locally

---

## initial setup

### branch: `setup/monorepo`

- [ ] run `bash scaffold.sh` to create monorepo structure
- [ ] navigate into `dredge` directory
- [ ] initialise git repository
- [ ] add remote origin pointing to your GitHub repo
- [ ] run `npm install` to install all dependencies
- [ ] commit with message `"chore: scaffold monorepo"`
- [ ] push branch, open pull request, merge, delete branch

---

## test setup

### branch: `setup/testing`

- [ ] checkout main and pull latest
- [ ] create branch `setup/testing`
- [ ] install vitest and coverage package in orchestrator workspace:
  ```bash
  npm install --save-dev vitest @vitest/coverage-v8 --workspace=apps/orchestrator
  ```
- [ ] add scripts to `apps/orchestrator/package.json`:
  ```json
  "test": "vitest",
  "test:coverage": "vitest run --coverage"
  ```
- [ ] create `apps/orchestrator/src/__tests__/` folder
- [ ] commit with message `"chore: add vitest to orchestrator"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 1 — shared schemas package

### branch: `feat/shared-schemas`

This package is the single source of truth for all types across orchestrator, frontend, and database.

- [ ] create `packages/schemas/` directory
- [ ] create `package.json` with name `@dredge/schemas`, version, and zod as dependency
- [ ] configure TypeScript build

#### crime domain schemas

- [ ] define crime category slugs and `CrimeCategory` enum:
  ```
  all-crime, anti-social-behaviour, bicycle-theft, burglary,
  criminal-damage-arson, drugs, other-theft, possession-of-weapons,
  public-order, robbery, shoplifting, theft-from-the-person,
  vehicle-crime, violent-crime, other-crime
  ```
- [ ] define `VizHint` type — `"map" | "bar" | "table"` — **not a schema field on QueryPlan**; derived deterministically after parsing
- [ ] define `QueryPlanSchema` — category, date_from (`YYYY-MM`), date_to (`YYYY-MM`), location (place name string, **not coordinates**)
- [ ] define `ParsedQuerySchema` — extends `QueryPlanSchema`, adds `viz_hint`, `resolved_location`, `months`
  > **viz hint rules** — derived from query shape after parsing, never from the LLM:
  > - single month + single location → `"map"`
  > - multiple months, any location → `"bar"`
  > - any query where category is `"all-crime"` and range > 1 month → `"bar"`
  > - explicit "list", "show me", "what are" phrasing → `"table"`
  > - default → `"map"`
- [ ] define `IntentErrorSchema`:
  ```ts
  {
    error: "incomplete_intent" | "invalid_intent" | "geocode_failed",
    understood: Partial<QueryPlan>,
    missing: string[],
    message: string
  }
  ```
- [ ] define `PoliceCrimeSchema` with `.passthrough()`
- [ ] define `CrimeResultSchema`

#### domain config schemas

- [ ] define `LocationStyle` — `"polygon"` | `"coordinates"` — controls whether geocoder returns a poly string or lat/lon pair
- [ ] define `DomainConfigSchema`:
  ```ts
  {
    name: string,                          // e.g. "crime-uk", "weather"
    tableName: string,                     // e.g. "crime_results_uk", "weather_results"
    countries: string[],                   // ISO 3166-1 alpha-2, e.g. ["GB"]
    apiUrl: string,
    apiKeyEnv: string | null,              // env var name for API key, null if no auth
    locationStyle: LocationStyle,
    params: Record<string, string>,        // static query params merged on every request
    flattenRow: Record<string, string>,    // dot-path map: { "temp_max": "main.temp_max" }
    categoryMap: Record<string, string>,   // canonical → API-specific slug
    vizHintRules: {
      defaultHint: VizHint,
      multiMonthHint: VizHint
    }
  }
  ```
  > **flattenRow note:** keys are the database column names; values are dot-paths into the API response object. `"$"` as a value means the entire row, used for the `raw` column. The generic store uses this map to extract values without bespoke TypeScript per domain.

#### shared utility schemas

- [ ] define `NominatimResponseSchema` — array of hits each with `boundingbox`, `display_name`, `lat`, `lon`, `country_code`
- [ ] define `CoordinatesSchema` — validates `{ lat: number, lon: number, display_name: string, country_code: string }`
- [ ] define `PolygonSchema` — validates `"lat,lng:lat,lng"` format, max 100 points
- [ ] define `PostgresColumnType` — allowed types: `text`, `integer`, `bigint`, `boolean`, `double precision`, `jsonb`, `timestamptz`
- [ ] define `AddColumnSchema` — validates schema evolution op shape
- [ ] define `SchemaOp` type

- [ ] export all schemas and inferred TypeScript types
- [ ] build package:
  ```bash
  npm run build --workspace=packages/schemas
  ```
- [ ] commit with message `"feat: schemas — domain config schema, country_code on coordinates"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 2 — database schema

### branch: `feat/database-schema`

- [ ] open `packages/database/prisma/schema.prisma`

#### docker setup — PostGIS

- [ ] update `docker-compose.yml` to use PostGIS image:
  ```yaml
  services:
    postgres:
      image: postgis/postgis:16-3.4
      environment:
        POSTGRES_USER: postgres
        POSTGRES_PASSWORD: postgres
        POSTGRES_DB: dredge
      ports:
        - "5432:5432"
      volumes:
        - postgres_data:/var/lib/postgresql/data

  volumes:
    postgres_data:
  ```
- [ ] start the container:
  ```bash
  docker compose up -d
  ```
- [ ] enable PostGIS extension:
  ```bash
  docker exec -it dredge-postgres-1 psql -U postgres -d dredge -c "CREATE EXTENSION IF NOT EXISTS postgis;"
  ```
  > **collation warning:** if you see a collation version mismatch warning, run:
  > ```bash
  > docker exec -it dredge-postgres-1 psql -U postgres -d dredge -c "ALTER DATABASE dredge REFRESH COLLATION VERSION;"
  > ```

#### query model

- [ ] define `Query` model:
  - `id`, `text`, `category`, `date_from`, `date_to`, `poly`, `viz_hint`, `createdAt`
  - `domain String @default("crime-uk")` — identifies the adapter used
  - `resolved_location String?`
  - `country_code String?` — stored from geocoder for routing audit
  - relation to `CrimeResult[]`

#### crime result model

- [ ] define `CrimeResult` model:
  - `id`, `query_id`, `persistent_id`, `category`, `month`
  - `street`, `latitude` (Float), `longitude` (Float)
  - `outcome_category`, `outcome_date`
  - `location_type`, `context`
  - `raw Json?`

  > **convention:** every domain result table must have a `raw Json?` column. This is non-negotiable — no data is ever lost regardless of schema state.

#### schema version model

- [ ] define `SchemaVersion` model:
  - `id`, `table_name`, `column_name`, `column_type`, `triggered_by`, `createdAt`
  - `domain String @default("crime-uk")`

- [ ] run initial migration:
  ```bash
  npm run db:migrate
  # name the migration: initial
  ```
- [ ] verify in Prisma Studio:
  ```bash
  npm run db:studio
  ```
- [ ] confirm `Query`, `CrimeResult`, `SchemaVersion` tables exist
- [ ] confirm `Query` has `domain`, `country_code`, `resolved_location` columns
- [ ] confirm `CrimeResult` has `raw` column of type `Json`
- [ ] commit with message `"feat: database schema — postgis docker, country_code on query"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 3 — database singleton

### branch: `feat/db-singleton`

- [ ] create `apps/orchestrator/src/db.ts`
- [ ] import `PrismaClient` from database package
- [ ] attach to `globalThis` to survive hot reloads
- [ ] export single `prisma` instance

**tests** — `apps/orchestrator/src/__tests__/db.test.ts`
- [ ] prisma instance is defined
- [ ] same instance returned on multiple imports

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: prisma singleton"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 4 — express server

### branch: `feat/express-server`

- [ ] create `apps/orchestrator/src/index.ts`
- [ ] load `dotenv/config`
- [ ] create express app with `cors()` and `express.json()` middleware
- [ ] mount `queryRouter` on `/query` — comment out until step 11
- [ ] implement `GET /health` → `{ status: "ok", timestamp: new Date().toISOString() }`
- [ ] `app.listen(PORT)` where `PORT` defaults to `3001`

**tests** — `apps/orchestrator/src/__tests__/index.test.ts`
- [ ] `GET /health` returns status 200
- [ ] body contains `{ status: "ok" }`
- [ ] body contains a valid ISO 8601 `timestamp`

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: express server with health endpoint"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 5 — intent parser

### branch: `feat/intent-parser`

> **structure note:** create at `apps/orchestrator/src/crime/intent.ts`. The `src/crime/` subdirectory means adding `src/weather/` or `src/traffic/` is purely additive.

- [ ] create `apps/orchestrator/src/crime/intent.ts`
- [ ] configure DeepSeek client:
  ```ts
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com",
  });
  ```
- [ ] build system prompt — enforce:
  - return JSON only, no prose, no markdown fences
  - `location` must be a place name, **never coordinates**
  - default `location` to `"Cambridge, UK"` when none specified
  - default `category` to `"all-crime"` when unclear
  - resolve `date_from` and `date_to` as explicit `YYYY-MM` — never pass relative expressions through
  - do **not** include `viz_hint` in output
  - list all valid category slugs
- [ ] implement `stripFences(text)`
- [ ] implement `deriveVizHint(plan, rawText): VizHint`
- [ ] implement `expandDateRange(date_from, date_to): string[]`
- [ ] implement `parseIntent(rawText): Promise<QueryPlan>`
- [ ] export all three from `apps/orchestrator/src/crime/index.ts`

**tests** — `apps/orchestrator/src/__tests__/crime/intent.test.ts`
- [ ] returns valid `QueryPlan`
- [ ] `viz_hint` not present on returned plan
- [ ] `location` is a place name, never coordinates
- [ ] resolves relative date expressions correctly
- [ ] throws structured `IntentError` with `understood` and `missing` on failure
- [ ] throws on blank input

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: crime intent parser"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 6 — geocoder

### branch: `feat/geocoder`

- [ ] create `apps/orchestrator/src/geocoder.ts`
- [ ] update `NominatimResponseSchema` to include `country_code` field
- [ ] implement `queryNominatim(location)` — shared internal helper:
  - calls `https://nominatim.openstreetmap.org/search`
  - params: `{ q: location, format: "json", limit: 1 }`
  - `User-Agent: "dredge/1.0"` header required
  - throws structured error if result array is empty

- [ ] implement `geocodeToPolygon(location, prisma, radiusMeters = 5000)`:
  - call `queryNominatim` to get centroid `lat`, `lon`
  - generate 16-point polygon via PostGIS `ST_Project`:
    ```sql
    SELECT string_agg(
      round(ST_Y(pt)::numeric, 6) || ',' || round(ST_X(pt)::numeric, 6),
      ':' ORDER BY n
    ) AS poly
    FROM (
      SELECT n,
        ST_Project(
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
          ${radiusMeters},
          radians(n * (360.0 / 16))
        )::geometry AS pt
      FROM generate_series(0, 15) AS n
    ) pts
    ```
  - validate result with `PolygonSchema.parse()`
  - return `{ poly, display_name, country_code }`

  > **why PostGIS over bounding box:** Nominatim bounding boxes for large administrative areas (boroughs, counties) regularly exceed the Police API's undocumented polygon area limit, returning a silent 404. A fixed-radius circle from the centroid gives consistent results regardless of how Nominatim sizes the administrative boundary. 5km is a good default for neighbourhood queries; callers can override `radiusMeters`.

- [ ] implement `geocodeToCoordinates(location)`:
  - call `queryNominatim`
  - return `{ lat, lon, display_name, country_code }`
  - validate with `CoordinatesSchema.parse()`

  > **forward-compatibility note:** `geocodeToCoordinates` is used by all non-polygon domains. Weather, traffic, and events APIs all want `lat/lon`, not a poly string.

**tests** — `apps/orchestrator/src/__tests__/geocoder.test.ts`
- [ ] mock axios and prisma
- [ ] `geocodeToPolygon` calls Nominatim with correct params and User-Agent
- [ ] `geocodeToPolygon` calls PostGIS `ST_Project` query
- [ ] `geocodeToPolygon` returns `{ poly, display_name, country_code }`
- [ ] returned poly has 16 points (not 4)
- [ ] throws structured IntentError on empty Nominatim result
- [ ] `geocodeToCoordinates` returns `{ lat, lon, display_name, country_code }`
- [ ] `country_code` is uppercased on both functions

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: geocoder — postgis radius polygon, country_code"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 7 — api fetcher

### branch: `feat/api-fetcher`

- [ ] create `apps/orchestrator/src/crime/fetcher.ts`
- [ ] implement `fetchCrimesForMonth(plan, poly, month)`:
  - validates poly does not exceed 100 points
  - calls `https://data.police.uk/api/crimes-street/{plan.category}`
  - params: `{ date: month, poly }`
  - validates response with `z.array(PoliceCrimeSchema).parse()` using `.passthrough()`
- [ ] implement `fetchCrimes(plan, poly)`:
  - expands date range with `expandDateRange`
  - calls `fetchCrimesForMonth` **sequentially** for each month

**tests** — `apps/orchestrator/src/__tests__/crime/fetcher.test.ts`
- [ ] calls correct URL and params
- [ ] unknown fields on crime objects preserved
- [ ] fetches sequentially, not in parallel
- [ ] merges results from all months

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: crime fetcher — sequential date range expansion"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 8 — schema evolution

### branch: `feat/schema-evolution`

- [ ] create `apps/orchestrator/src/schema.ts`
- [ ] implement `getCurrentColumns(prisma, tableName)`
- [ ] implement `findNewKeys(sampleRow, existingColumns)`
- [ ] implement `inferPostgresType(value)`:
  ```
  string           → "text"
  integer number   → "integer"
  decimal number   → "double precision"
  boolean          → "boolean"
  object/array     → "jsonb"
  null/undefined   → "text"
  ```
- [ ] implement `evolveSchema(prisma, tableName, sampleRow, triggeredBy, domain)`:
  - get current columns, find new keys
  - if none → return immediately
  - loop every new key → `applySchemaOp`
- [ ] implement `applySchemaOp(prisma, op, triggeredBy, tableName, domain)`:
  - validate SQL against safe regex before executing
  - execute with `prisma.$executeRawUnsafe`
  - write `SchemaVersion` audit record with `domain`

**tests** — `apps/orchestrator/src/__tests__/schema.test.ts`
- [ ] returns immediately when no new keys
- [ ] correct Postgres type inferred for each value type
- [ ] one `applySchemaOp` call per new key
- [ ] `SchemaVersion` record written per column

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: schema evolution — table-name aware, domain-aware"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 9 — store

### branch: `feat/store`

- [ ] create `apps/orchestrator/src/crime/store.ts`
- [ ] implement `flattenCrime(crime)`:
  - `latitude` as `parseFloat(crime.location.latitude)`
  - `longitude` as `parseFloat(crime.location.longitude)`
  - `street` from `crime.location.street.name`
  - `raw: crime` — full original object
  - spread unknown top-level fields
- [ ] implement `storeResults(queryId, crimes, prisma)`:
  - early return on empty array
  - query live column set before inserting
  - filter each row to existing columns only
  - validate with `CrimeResultSchema.partial().safeParse()` — warn, don't throw
  - batch insert with `prisma.$transaction`

**tests** — `apps/orchestrator/src/__tests__/crime/store.test.ts`
- [ ] `latitude` and `longitude` stored as floats
- [ ] `raw` contains full original object
- [ ] only writes columns that currently exist
- [ ] does not call `prisma.$transaction` on empty array

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: crime store — dynamic column filter, raw jsonb"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 10 — domain registry

### branch: `feat/domain-registry`

This step introduces the routing layer that connects geocoded location to the correct data adapter. Adding a new domain later is a single file and a single registry entry.

- [ ] create `apps/orchestrator/src/domains/registry.ts`
- [ ] define `DomainAdapter` interface:
  ```ts
  interface DomainAdapter {
    config: DomainConfig;
    fetchData: (plan: QueryPlan, locationArg: string) => Promise<unknown[]>;
    flattenRow: (row: unknown) => Record<string, unknown>;
    storeResults: (queryId: string, rows: unknown[], prisma: any) => Promise<void>;
  }
  ```
- [ ] implement `registerDomain(adapter: DomainAdapter)`
- [ ] implement `getDomainForCountry(countryCode: string): DomainAdapter | undefined` — looks up by `config.countries`
- [ ] implement `getDomainByName(name: string): DomainAdapter | undefined`
- [ ] implement `loadDomains()` — called once at server startup, registers all known adapters
- [ ] create `apps/orchestrator/src/domains/crime-uk.ts` — wraps existing crime pipeline as the first adapter:
  ```ts
  export const crimeUkAdapter: DomainAdapter = {
    config: {
      name: "crime-uk",
      tableName: "crime_results",
      countries: ["GB"],
      locationStyle: "polygon",
      ...
    },
    fetchData: (plan, poly) => fetchCrimes(plan, poly),
    flattenRow: flattenCrime,
    storeResults,
  };
  ```
- [ ] call `loadDomains()` in `src/index.ts` before `app.listen`

> **design note:** the adapter wraps the existing functions unchanged. `crime-uk.ts` is a thin registration wrapper — `fetcher.ts`, `store.ts`, and `intent.ts` stay exactly as they are. No existing code is modified.

**tests** — `apps/orchestrator/src/__tests__/domains/registry.test.ts`
- [ ] `getDomainForCountry("GB")` returns crime-uk adapter
- [ ] `getDomainForCountry("US")` returns undefined when no US adapter registered
- [ ] `getDomainByName("crime-uk")` returns correct adapter
- [ ] `getDomainByName("unknown")` returns undefined
- [ ] registering the same domain name twice overwrites the first

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: domain registry — crime-uk registered as first adapter"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 11 — query pipeline

### branch: `feat/query-pipeline`

The query pipeline now routes through the domain registry. `POST /query/parse` and `POST /query/execute` are called back-to-back by the frontend — there is no user confirmation step between them.

- [ ] create `apps/orchestrator/src/query.ts`
- [ ] define `ParseBodySchema`: `{ text: z.string().min(1) }`
- [ ] define `ExecuteBodySchema`: `{ plan: QueryPlanSchema, poly: z.string(), viz_hint: VizHintSchema, resolved_location: z.string(), country_code: z.string() }`

#### POST /query/parse

- [ ] validate `req.body`
- [ ] call `parseIntent(text)` — return 400 with structured IntentError on failure
- [ ] call `geocodeToPolygon(plan.location, prisma)` — returns `{ poly, display_name, country_code }`
  - for non-polygon domains, call `geocodeToCoordinates` instead — determined by looking up the domain for the returned `country_code` and checking `config.locationStyle`
- [ ] derive `viz_hint` from `deriveVizHint(plan, text)`
- [ ] return confirmation payload — **no database write**:
  ```json
  {
    "plan": { "category", "date_from", "date_to", "location" },
    "poly": "...",
    "viz_hint": "map",
    "resolved_location": "Cambridge, Cambridgeshire, England",
    "country_code": "GB",
    "months": ["2024-01"]
  }
  ```

#### POST /query/execute

- [ ] validate `req.body`
- [ ] look up domain adapter via `getDomainForCountry(country_code)` — return 400 if no adapter found:
  ```json
  {
    "error": "unsupported_region",
    "message": "No data source available for country: US",
    "country_code": "US"
  }
  ```
- [ ] create `Query` record with `domain: adapter.config.name`, `country_code`
- [ ] call `adapter.fetchData(plan, poly)`
- [ ] if results returned, call `evolveSchema(prisma, adapter.config.tableName, results[0], queryRecord.id, adapter.config.name)`
- [ ] call `adapter.storeResults(queryRecord.id, results, prisma)`
- [ ] fetch stored rows back from database — return these, not the raw API response:
  ```ts
  const storedResults = await prisma[adapter.config.prismaModel].findMany({
    where: { query_id: queryRecord.id },
    take: 100,
  });
  ```
  > **why stored rows:** the raw API response has nested fields (`location.latitude`). Stored rows have flattened top-level fields (`latitude`, `longitude`) that the frontend can use directly. Returning stored rows also means the frontend always gets typed, validated data.
- [ ] return `{ query_id, plan, poly, viz_hint, resolved_location, count, months_fetched, results: storedResults }`

#### GET /query/:id

- [ ] `prisma.query.findUnique` with `include: { results: true }`
- [ ] return 404 if not found

- [ ] uncomment `queryRouter` in `index.ts`

**tests** — `apps/orchestrator/src/__tests__/query.test.ts`

**POST /query/parse tests**
- [ ] returns 400 on missing `text`
- [ ] returns structured IntentError when parseIntent throws
- [ ] returns `country_code` in confirmation payload
- [ ] does not write to database
- [ ] does not call fetchData

**POST /query/execute tests**
- [ ] returns 400 when `country_code` has no registered adapter
- [ ] error payload includes `error: "unsupported_region"` and `country_code`
- [ ] creates Query record with `domain` from adapter config
- [ ] stores `country_code` on Query record
- [ ] calls `evolveSchema` with adapter's `tableName`
- [ ] returns stored rows, not raw API response
- [ ] `latitude` and `longitude` are numbers on returned results
- [ ] returns 500 when fetchData throws

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: query pipeline — domain routing, stored rows returned"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 12 — frontend

### branch: `feat/frontend`

The frontend calls parse and execute back-to-back. There is no blocking confirmation step — the interpreted plan is shown as a banner above the results with a "Refine ↩" link.

- [ ] install map dependencies:
  ```bash
  npm install react-map-gl maplibre-gl @deck.gl/core @deck.gl/layers @deck.gl/aggregation-layers @deck.gl/mapbox --workspace=apps/web
  ```
- [ ] implement single-file `apps/web/src/App.tsx`:

#### query flow

- [ ] `handleQuery(text)`:
  - set `loadingStage: "interpreting"`, call `POST /query/parse`
  - on parse error → show `IntentErrorPanel`, return
  - set `loadingStage: "fetching"`, call `POST /query/execute` immediately with parse result
  - on execute error → show error panel, return
  - set `parsed` (for banner) and `result` (for renderer), set stage `"done"`
- [ ] `handleRefine()` — clears all state, returns to idle with text pre-populated

#### components

- [ ] `QueryInput`:
  - controlled input, submit on Enter or button
  - button label changes: `"Search"` → `"Interpreting..."` → `"Fetching data..."`
  - animated loading bar — slower animation during `"fetching"` stage to signal longer wait
  - example query chips shown when input is empty and not loading
- [ ] `InterpretationBanner`:
  - slim bar above results: `Searched for burglaries in Cambridge · January 2024 · map`
  - amber left border
  - `"Refine ↩"` ghost button — does not block execution
- [ ] `IntentErrorPanel`:
  - green chips for `understood` fields: `✓ category: burglary`
  - amber chips for `missing` fields: `? missing: location`
  - hint text when nothing was understood
  - `"← Try again"` button
- [ ] `EmptyResults`:
  - shown when `count === 0`
  - explains police data lag (~2–3 months)
  - `"Refine query"` button
- [ ] `MapView` — real MapLibre map with deck.gl overlay:
  - three modes: **points** (ScatterplotLayer), **clusters** (HexagonLayer), **heatmap** (HeatmapLayer)
  - mode buttons: amber background on active mode
  - hover tooltip: category, street, month, outcome
  - `DeckGLOverlay` component using `MapboxOverlay` + `useControl`
  - map tile style: `https://tiles.openfreemap.org/styles/liberty`
  - initial view centred on first result point
- [ ] `BarChart` — monthly counts, amber bars
- [ ] `TableView` — category, street, month, outcome; capped at 50 rows

#### styling

- [ ] dark terminal aesthetic: `#0a0a0b` background, amber `#f5a623` accents
- [ ] JetBrains Mono + Syne fonts
- [ ] all CSS inlined in the single file as a template literal

- [ ] commit with message `"feat: frontend — single-step flow, real map, interpretation banner"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 13 — adding a new domain (walkthrough)

### branch: `feat/domain-<name>`

This step documents the pattern for adding any new domain. No existing files are modified.

#### example: weather domain

- [ ] create `apps/orchestrator/src/domains/configs/weather.json`:
  ```json
  {
    "name": "weather",
    "tableName": "weather_results",
    "countries": [],
    "apiUrl": "https://api.openweathermap.org/data/2.5/forecast",
    "apiKeyEnv": "OPENWEATHER_API_KEY",
    "locationStyle": "coordinates",
    "params": { "units": "metric", "cnt": "8" },
    "flattenRow": {
      "date": "dt_txt",
      "temp_max": "main.temp_max",
      "temp_min": "main.temp_min",
      "feels_like": "main.feels_like",
      "humidity": "main.humidity",
      "description": "weather[0].description",
      "wind_speed": "wind.speed",
      "rainfall": "rain.3h",
      "raw": "$"
    },
    "categoryMap": {
      "temperature": "temperature",
      "rainfall": "rain",
      "wind": "wind"
    },
    "vizHintRules": {
      "defaultHint": "bar",
      "multiMonthHint": "bar"
    }
  }
  ```
- [ ] add `WeatherResult` model to `schema.prisma`:
  ```prisma
  model WeatherResult {
    id          String   @id @default(cuid())
    query_id    String
    date        String?
    temp_max    Float?
    temp_min    Float?
    description String?
    raw         Json?
    query       Query    @relation(fields: [query_id], references: [id])

    @@map("weather_results")
  }
  ```
  > **note:** only add the columns you know about upfront. Schema evolution will add any new columns the API returns on first query.
- [ ] run `db:migrate` and name the migration `add_weather_results`
- [ ] create `apps/orchestrator/src/domains/weather.ts`:
  ```ts
  import config from "./configs/weather.json";
  import { genericFetcher } from "../generic/fetcher";
  import { genericFlattenRow, genericStoreResults } from "../generic/store";

  export const weatherAdapter: DomainAdapter = {
    config,
    fetchData: (plan, locationArg) => genericFetcher(config, plan, locationArg),
    flattenRow: (row) => genericFlattenRow(config.flattenRow, row),
    storeResults: (queryId, rows, prisma) =>
      genericStoreResults(queryId, rows, config.tableName, prisma),
  };
  ```
- [ ] register in `loadDomains()`:
  ```ts
  registerDomain(weatherAdapter);
  ```
- [ ] update `getDomainForCountry` or add a `classifyIntent` step to choose weather vs crime for the same country

**what you do not touch:**
- `query.ts` — routing logic is already there
- `schema.ts` — `evolveSchema` already accepts any `tableName`
- `geocoder.ts` — `geocodeToCoordinates` already returns what weather needs
- `SchemaVersion` — domain field already present
- the frontend — `viz_hint`, `count`, `results` are domain-agnostic

- [ ] commit with message `"feat: weather domain — config-driven adapter"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 14 — generic fetcher and store

### branch: `feat/generic-adapters`

The generic fetcher and store are shared infrastructure that config-driven adapters use. Simple REST APIs that return JSON arrays need no bespoke TypeScript — just a config file.

- [ ] create `apps/orchestrator/src/generic/fetcher.ts`:
  - reads `apiUrl`, `apiKeyEnv`, `locationStyle`, `params` from config
  - if `locationStyle === "coordinates"` — expects `locationArg` as `"lat,lon"` string
  - if `locationStyle === "polygon"` — passes `locationArg` as `poly` param
  - merges static `params` with dynamic `{ date, lat, lon }` or `{ date, poly }`
  - adds API key from `process.env[config.apiKeyEnv]` if set
  - validates response is an array, returns `unknown[]`

- [ ] create `apps/orchestrator/src/generic/store.ts`:
  - implement `resolvePath(obj, path)` — resolves dot-path strings against an object:
    - `"main.temp_max"` → `obj.main.temp_max`
    - `"weather[0].description"` → `obj.weather[0].description`
    - `"$"` → entire object (for `raw` column)
  - implement `genericFlattenRow(flattenMap, row)` — applies `resolvePath` for each key in the map
  - implement `genericStoreResults(queryId, rows, tableName, prisma)`:
    - queries live column set for `tableName`
    - flattens each row with `genericFlattenRow`
    - filters to existing columns
    - batch inserts with `prisma.$transaction` using raw SQL (since table name is dynamic)

  > **why raw SQL for generic store:** Prisma's type-safe client requires a known model at compile time. Generic adapters write to tables whose names are only known at runtime. Use `prisma.$executeRaw` with parameterised queries — safe because column names are validated by the schema evolution regex before they are ever added.

**tests** — `apps/orchestrator/src/__tests__/generic/`
- [ ] `resolvePath` resolves simple dot paths
- [ ] `resolvePath` resolves array index paths
- [ ] `resolvePath` returns entire object for `"$"`
- [ ] `resolvePath` returns `undefined` for missing paths without throwing
- [ ] `genericFlattenRow` applies all paths from map
- [ ] `genericFlattenRow` handles missing paths gracefully
- [ ] `genericFetcher` passes API key header when `apiKeyEnv` is set
- [ ] `genericFetcher` passes `poly` param when `locationStyle === "polygon"`
- [ ] `genericFetcher` passes `lat`/`lon` params when `locationStyle === "coordinates"`

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: generic fetcher and store for config-driven domains"`
- [ ] push branch, open pull request, merge, delete branch

---

## smoke tests

```bash
git checkout main && git pull
npm run dev
```

- [ ] open `http://localhost:3000`

**single month query — UK**
- [ ] query: `show me burglaries in Cambridge in January 2024`
  - [ ] interpretation banner shows: `burglaries in Cambridge, Cambridgeshire, England · January 2024 · map`
  - [ ] map renders with amber scatter points
  - [ ] mode buttons switch between points / clusters / heatmap
  - [ ] hover tooltip shows category, street, month
  - [ ] Prisma Studio: Query row has `domain: "crime-uk"`, `country_code: "GB"`, `resolved_location` populated

**date range query — UK**
- [ ] query: `drug offences in Camden over the last 3 months`
  - [ ] bar chart renders with monthly counts
  - [ ] Prisma Studio: `date_from`, `date_to` correct

**large borough — polygon test**
- [ ] query: `violent crime in Camden last month`
  - [ ] no 404 from Police API — PostGIS polygon is within area limit
  - [ ] results render

**unsupported region**
- [ ] query: `crime in New York last month`
  - [ ] geocoder returns `country_code: "US"`
  - [ ] execute returns `error: "unsupported_region"`
  - [ ] frontend shows error panel with clear message

**intent error — missing location**
- [ ] query: `show me burglaries last month`
  - [ ] error panel shows `✓ category: burglary` and `? missing: location`

**schema evolution**
- [ ] open Prisma Studio after running queries:
  - [ ] `SchemaVersion` shows records with `domain: "crime-uk"`
  - [ ] `CrimeResult` rows have `raw` populated
  - [ ] `Query` rows have `country_code` and `domain` populated

---

## coverage check

```bash
npm run test:coverage --workspace=apps/orchestrator
```

- [ ] all tests passing
- [ ] line coverage above 80%
- [ ] branch coverage above 70%

---

## architecture

```
User text
  └─ Zod validates request body

     POST /query/parse — interpretation only, no side effects
       └─ crime/intent.ts — parseIntent()
            DeepSeek: category, date_from, date_to, location
            Relative dates resolved to YYYY-MM at parse time
            IntentError on failure with understood/missing fields
       └─ geocoder.ts — geocodeToPolygon() or geocodeToCoordinates()
            Nominatim resolves place name → centroid lat/lon
            PostGIS ST_Project generates 16-point 5km radius polygon
            Returns poly, display_name, country_code
       └─ crime/intent.ts — deriveVizHint()
       └─ Returns { plan, poly, viz_hint, resolved_location, country_code, months }
            No database write — frontend calls execute immediately

     POST /query/execute — runs on confirmed plan
       └─ domains/registry.ts — getDomainForCountry(country_code)
            Looks up registered adapter by country
            Returns 400 "unsupported_region" if none found
       └─ adapter.fetchData(plan, locationArg)
            Crime-UK: sequential per-month Police API calls
            Future domains: generic fetcher driven by DomainConfig
       └─ schema.ts — evolveSchema(prisma, tableName, sampleRow, id, domain)
            Table-name and domain aware
            Zod type inference → Postgres column types
            SchemaVersion audit record per new column
       └─ adapter.storeResults(queryId, rows, prisma)
            Filters to live column set before writing
            raw JSONB preserves full API response
       └─ prisma[model].findMany({ where: { query_id } })
            Returns stored rows with flattened lat/lon
            Frontend always receives typed, top-level fields

     Frontend
       └─ parse + execute called back-to-back, no confirmation click
       └─ InterpretationBanner shows plan above results
       └─ MapView: MapLibre + deck.gl, three render modes
       └─ BarChart: monthly counts
       └─ TableView: capped at 50 rows
```

**key principles:**
- Zod is the single source of truth for types across the entire stack.
- The LLM only extracts intent from natural language — it never produces coordinates, viz hints, or relative dates.
- `POST /query/parse` and `POST /query/execute` are separate endpoints called back-to-back. Parse is free of side effects; the frontend shows results immediately without a confirmation click.
- Domain routing is driven by `country_code` from Nominatim — no hardcoded geography in `query.ts`.
- Adding a domain requires: a config JSON file, a result model in Prisma, and a registry entry. No existing files change.
- Schema evolution is table-name and domain aware — new columns appear automatically on first query for any domain.
- Every result table has `raw Json?` — no data is ever lost regardless of schema state.
- The execute endpoint returns stored rows, not raw API responses — the frontend always receives flattened, typed fields.

---

## useful commands

| action | command |
|---|---|
| start database | `docker compose up -d` |
| stop database | `docker compose down` |
| run tests | `npm test --workspace=apps/orchestrator` |
| run coverage | `npm run test:coverage --workspace=apps/orchestrator` |
| run dev | `npm run dev` |
| prisma studio | `npm run db:studio` |
| new migration | `npm run db:migrate` |
| regenerate prisma client | `npm run db:generate` |
| reset database (dev only) | `npx prisma migrate reset --workspace=packages/database` |
| build shared schemas | `npm run build --workspace=packages/schemas` |
| enable postgis | `docker exec -it dredge-postgres-1 psql -U postgres -d dredge -c "CREATE EXTENSION IF NOT EXISTS postgis;"` |
| reload shell config | `source ~/.zshrc` |
