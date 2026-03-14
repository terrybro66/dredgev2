# dredge — implementation guide v4.1

---

## what changed from v4.0

- **query fingerprint + cache** — `POST /query/execute` generates a deterministic hash from the normalised query plan and checks `QueryCache` before hitting any external API; cache hits return instantly with stored results
- **geocoder cache** — Nominatim results are persisted to a `GeocoderCache` table; repeated place name lookups skip the HTTP call and PostGIS query entirely
- **`query_jobs` table** — every execute call writes a `QueryJob` audit record tracking status (`pending` → `complete` | `error`), duration, and row count; lightweight foundation for future retry/async work without introducing Redis
- **intent + country routing** — `getDomainForQuery(countryCode, intent)` replaces `getDomainForCountry`; distinguishes between domains that share a country (e.g. crime vs weather for GB); resolves the `countries: []` ambiguity for non-crime domains
- **`prismaModel` field on `DomainConfig`** — was missing from the schema spec in v4.0; required by `POST /query/execute` to call `prisma[adapter.config.prismaModel].findMany`
- **basic observability** — key timings (`parse_ms`, `geocode_ms`, `fetch_ms`, `store_ms`) and counts (`rows_inserted`, `cache_hit`) logged as structured JSON on every request; no external stack required
- **column name validation regex documented** — `applySchemaOp` validates against `/^[a-z][a-z0-9_]{0,62}$/` before executing any `ALTER TABLE`

---

## what changed from v3.2 (carried forward from v4.0)

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
    prismaModel: string,                   // e.g. "crimeResult", "weatherResult" — camelCase Prisma model name
    countries: string[],                   // ISO 3166-1 alpha-2, e.g. ["GB"]. Empty array = any country
    intents: string[],                     // intent keys this domain handles, e.g. ["crime"], ["weather"]
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
  > **prismaModel:** required by `POST /query/execute` to call `prisma[adapter.config.prismaModel].findMany` after storing results. This field was absent from v4.0 and caused a runtime error. Use the camelCase Prisma model name, e.g. `"crimeResult"` maps to the `CrimeResult` model.

  > **intents + countries routing:** the registry matches on both `country_code` and `intent`. A domain with `countries: ["GB"]` and `intents: ["crime"]` activates only for British crime queries. A domain with `countries: []` and `intents: ["weather"]` activates for weather queries in any country. This replaces the v4.0 country-only routing which could not distinguish multiple domains for the same country.

  > **flattenRow note:** keys are the database column names; values are dot-paths into the API response object. `"$"` as a value means the entire row, used for the `raw` column.

#### cache and job schemas

- [ ] define `QueryCacheEntrySchema`:
  ```ts
  {
    id: string,
    query_hash: string,      // SHA-256 of normalised { domain, category, date_from, date_to, resolved_location }
    domain: string,
    result_count: number,
    results: Json,           // stored flattened rows
    createdAt: DateTime
  }
  ```
- [ ] define `GeocoderCacheEntrySchema`:
  ```ts
  {
    id: string,
    place_name: string,      // normalised lowercase input
    display_name: string,
    lat: Float,
    lon: Float,
    country_code: string,
    poly: string | null,     // stored polygon string if previously generated
    createdAt: DateTime
  }
  ```
- [ ] define `QueryJobSchema`:
  ```ts
  {
    id: string,
    query_id: string,
    status: "pending" | "complete" | "error",
    domain: string,
    cache_hit: boolean,
    rows_inserted: number,
    parse_ms: number | null,
    geocode_ms: number | null,
    fetch_ms: number | null,
    store_ms: number | null,
    error_message: string | null,
    createdAt: DateTime,
    completedAt: DateTime | null
  }
  ```

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
- [ ] commit with message `"feat: schemas — prismaModel, intent routing, cache + job schemas"`
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
  - relation to `QueryJob[]`

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

#### query cache model

- [ ] define `QueryCache` model:
  ```prisma
  model QueryCache {
    id           String   @id @default(cuid())
    query_hash   String   @unique
    domain       String
    result_count Int
    results      Json
    createdAt    DateTime @default(now())
  }
  ```
  > **cache key:** `query_hash` is a SHA-256 of the normalised execute payload: `{ domain, category, date_from, date_to, resolved_location }`. Location is normalised to `display_name` from the geocoder (lowercased) so that "manchester" and "Manchester, England" hash identically.

#### geocoder cache model

- [ ] define `GeocoderCache` model:
  ```prisma
  model GeocoderCache {
    id           String   @id @default(cuid())
    place_name   String   @unique
    display_name String
    lat          Float
    lon          Float
    country_code String
    poly         String?
    createdAt    DateTime @default(now())
  }
  ```
  > **normalisation:** store and look up `place_name` as `input.trim().toLowerCase()`. This ensures "Cambridge", "cambridge", and " Cambridge " all hit the same cache row. The `poly` column is nullable — it is populated on first polygon geocode and reused thereafter.

#### query job model

- [ ] define `QueryJob` model:
  ```prisma
  model QueryJob {
    id            String    @id @default(cuid())
    query_id      String
    status        String    @default("pending")
    domain        String
    cache_hit     Boolean   @default(false)
    rows_inserted Int       @default(0)
    parse_ms      Int?
    geocode_ms    Int?
    fetch_ms      Int?
    store_ms      Int?
    error_message String?
    createdAt     DateTime  @default(now())
    completedAt   DateTime?
    query         Query     @relation(fields: [query_id], references: [id])
  }
  ```
  > **purpose:** `QueryJob` is a lightweight audit log, not a queue. It records what happened on every execute call — timings, row counts, cache hits, errors — giving you a queryable performance history without Redis or worker processes. If async execution is needed later, `QueryJob` is the natural table to build on.

- [ ] run initial migration:
  ```bash
  npm run db:migrate
  # name the migration: initial
  ```
- [ ] verify in Prisma Studio:
  ```bash
  npm run db:studio
  ```
- [ ] confirm `Query`, `CrimeResult`, `SchemaVersion`, `QueryCache`, `GeocoderCache`, `QueryJob` tables exist
- [ ] confirm `Query` has `domain`, `country_code`, `resolved_location` columns
- [ ] confirm `CrimeResult` has `raw` column of type `Json`
- [ ] commit with message `"feat: database schema — postgis, query cache, geocoder cache, query jobs"`
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
  - normalise `location` → `place_name = location.trim().toLowerCase()`
  - **check `GeocoderCache`** — `prisma.geocoderCache.findUnique({ where: { place_name } })`:
    - if cache hit and `poly` is present → return `{ poly, display_name, country_code }` immediately; skip Nominatim and PostGIS
    - if cache hit but `poly` is null → centroid is cached; skip Nominatim, run PostGIS only, then update cache row with generated poly
    - if no cache hit → call Nominatim, then PostGIS, write new cache row
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
  - write `GeocoderCache` row: `{ place_name, display_name, lat, lon, country_code, poly }`
  - return `{ poly, display_name, country_code }`

  > **why PostGIS over bounding box:** Nominatim bounding boxes for large administrative areas (boroughs, counties) regularly exceed the Police API's undocumented polygon area limit, returning a silent 404. A fixed-radius circle from the centroid gives consistent results regardless of how Nominatim sizes the administrative boundary. 5km is a good default for neighbourhood queries; callers can override `radiusMeters`.

  > **why cache geocoding:** Nominatim + PostGIS is the slowest step in `POST /query/parse`. Most query sessions reuse a small set of place names — the cache eliminates both the HTTP call and the PostGIS query on repeated lookups.

- [ ] implement `geocodeToCoordinates(location, prisma)`:
  - normalise `location` → `place_name = location.trim().toLowerCase()`
  - **check `GeocoderCache`** — if cache hit, return `{ lat, lon, display_name, country_code }` immediately
  - if no cache hit → call `queryNominatim`, write cache row (with `poly: null`), return result
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
- [ ] `geocodeToPolygon` skips Nominatim on cache hit (poly present)
- [ ] `geocodeToPolygon` skips PostGIS on full cache hit (poly present)
- [ ] `geocodeToCoordinates` skips Nominatim on cache hit
- [ ] cache row written on first call for a new place name
- [ ] place name normalised to lowercase before cache lookup

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: geocoder — postgis radius polygon, country_code, geocoder cache"`
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
  - validate column name against safe regex `/^[a-z][a-z0-9_]{0,62}$/` before executing — rejects anything that could escape the `ALTER TABLE` statement
  - execute with `prisma.$executeRawUnsafe`
  - write `SchemaVersion` audit record with `domain`

**tests** — `apps/orchestrator/src/__tests__/schema.test.ts`
- [ ] returns immediately when no new keys
- [ ] correct Postgres type inferred for each value type
- [ ] one `applySchemaOp` call per new key
- [ ] `SchemaVersion` record written per column
- [ ] `applySchemaOp` throws on column name failing safe regex

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: schema evolution — table-name aware, domain-aware, column name validation"`
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
- [ ] implement `getDomainForQuery(countryCode: string, intent: string): DomainAdapter | undefined`:
  - a domain matches if `config.intents` includes `intent`
  - **and** either `config.countries` includes `countryCode`, or `config.countries` is empty (match any country)
  - example: `getDomainForQuery("GB", "crime")` → crime-uk; `getDomainForQuery("US", "weather")` → weather adapter (if registered with `countries: []`)
  > **replaces `getDomainForCountry`:** country-only routing could not distinguish two domains covering the same country. Intent + country routing resolves this cleanly without changing how adapters are registered.
- [ ] implement `getDomainByName(name: string): DomainAdapter | undefined`
- [ ] implement `loadDomains()` — called once at server startup, registers all known adapters
- [ ] create `apps/orchestrator/src/domains/crime-uk.ts` — wraps existing crime pipeline as the first adapter:
  ```ts
  export const crimeUkAdapter: DomainAdapter = {
    config: {
      name: "crime-uk",
      tableName: "crime_results",
      prismaModel: "crimeResult",
      countries: ["GB"],
      intents: ["crime"],
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
- [ ] `getDomainForQuery("GB", "crime")` returns crime-uk adapter
- [ ] `getDomainForQuery("US", "crime")` returns undefined when no US crime adapter registered
- [ ] `getDomainForQuery("GB", "weather")` returns undefined when no weather adapter registered
- [ ] domain with `countries: []` matches any country when intent matches
- [ ] `getDomainByName("crime-uk")` returns correct adapter
- [ ] `getDomainByName("unknown")` returns undefined
- [ ] registering the same domain name twice overwrites the first

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: domain registry — intent+country routing, crime-uk registered"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 11 — query pipeline

### branch: `feat/query-pipeline`

The query pipeline routes through the domain registry and includes query caching, job tracking, and structured timing logs. `POST /query/parse` and `POST /query/execute` are called back-to-back by the frontend — there is no user confirmation step between them.

- [ ] create `apps/orchestrator/src/query.ts`
- [ ] define `ParseBodySchema`: `{ text: z.string().min(1) }`
- [ ] define `ExecuteBodySchema`: `{ plan: QueryPlanSchema, poly: z.string(), viz_hint: VizHintSchema, resolved_location: z.string(), country_code: z.string(), intent: z.string() }`

#### POST /query/parse

- [ ] validate `req.body`
- [ ] record `parse_start = Date.now()`
- [ ] call `parseIntent(text)` — return 400 with structured IntentError on failure
- [ ] record `geocode_start = Date.now()`
- [ ] call `geocodeToPolygon(plan.location, prisma)` (or `geocodeToCoordinates` for non-polygon domains — determined by looking up `getDomainForQuery(country_code, intent)` and checking `config.locationStyle`)
- [ ] derive `viz_hint` from `deriveVizHint(plan, text)`
- [ ] derive `intent` — `"crime"` for all queries in this version; extensible when further domains are added
- [ ] return confirmation payload — **no database write**:
  ```json
  {
    "plan": { "category", "date_from", "date_to", "location" },
    "poly": "...",
    "viz_hint": "map",
    "resolved_location": "Cambridge, Cambridgeshire, England",
    "country_code": "GB",
    "intent": "crime",
    "months": ["2024-01"]
  }
  ```

#### POST /query/execute

- [ ] validate `req.body`
- [ ] look up domain adapter via `getDomainForQuery(country_code, intent)` — return 400 if no adapter found:
  ```json
  {
    "error": "unsupported_region",
    "message": "No data source available for country: US / intent: crime",
    "country_code": "US"
  }
  ```

**cache check:**
- [ ] compute `query_hash`:
  ```ts
  import crypto from "crypto";
  const hashInput = JSON.stringify({
    domain: adapter.config.name,
    category: plan.category,
    date_from: plan.date_from,
    date_to: plan.date_to,
    resolved_location: resolved_location.toLowerCase()
  });
  const query_hash = crypto.createHash("sha256").update(hashInput).digest("hex");
  ```
- [ ] check `prisma.queryCache.findUnique({ where: { query_hash } })`
- [ ] if cache hit:
  - create `Query` record
  - create `QueryJob` with `cache_hit: true`, `status: "complete"`, `rows_inserted: cached.result_count`, `completedAt: new Date()`
  - log: `{ event: "execute", cache_hit: true, domain, query_hash, result_count: cached.result_count }`
  - return cached results immediately — no API calls

**live execution (cache miss):**
- [ ] create `Query` record with `domain: adapter.config.name`, `country_code`
- [ ] create `QueryJob` with `status: "pending"`, `cache_hit: false`
- [ ] record `fetch_start`; call `adapter.fetchData(plan, poly)`; record `fetch_ms`
- [ ] record `store_start`
- [ ] if results returned, call `evolveSchema(prisma, adapter.config.tableName, results[0], queryRecord.id, adapter.config.name)`
- [ ] call `adapter.storeResults(queryRecord.id, results, prisma)`; record `store_ms`
- [ ] fetch stored rows:
  ```ts
  const storedResults = await prisma[adapter.config.prismaModel].findMany({
    where: { query_id: queryRecord.id },
    take: 100,
  });
  ```
  > **why stored rows:** the raw API response has nested fields (`location.latitude`). Stored rows have flattened top-level fields (`latitude`, `longitude`) that the frontend can use directly.
- [ ] write `QueryCache` row: `{ query_hash, domain, result_count: storedResults.length, results: storedResults }`
- [ ] update `QueryJob`: `status: "complete"`, `rows_inserted`, `fetch_ms`, `store_ms`, `completedAt: new Date()`
- [ ] emit structured log:
  ```ts
  console.log(JSON.stringify({
    event: "execute",
    cache_hit: false,
    domain: adapter.config.name,
    query_hash,
    fetch_ms,
    store_ms,
    rows_inserted: storedResults.length
  }));
  ```
- [ ] return `{ query_id, plan, poly, viz_hint, resolved_location, count, months_fetched, results: storedResults }`

**error handling:**
- [ ] wrap fetch + store in try/catch
- [ ] on error: update `QueryJob` with `status: "error"`, `error_message: err.message`, `completedAt: new Date()`
- [ ] emit: `{ event: "execute_error", domain, error: err.message }`
- [ ] return 500

#### GET /query/:id

- [ ] `prisma.query.findUnique` with `include: { results: true }`
- [ ] return 404 if not found

- [ ] uncomment `queryRouter` in `index.ts`

**tests** — `apps/orchestrator/src/__tests__/query.test.ts`

**POST /query/parse tests**
- [ ] returns 400 on missing `text`
- [ ] returns structured IntentError when parseIntent throws
- [ ] returns `country_code` and `intent` in confirmation payload
- [ ] does not write to database
- [ ] does not call fetchData

**POST /query/execute tests**
- [ ] returns 400 when `country_code` + `intent` has no registered adapter
- [ ] error payload includes `error: "unsupported_region"` and `country_code`
- [ ] returns cached results without calling fetchData on cache hit
- [ ] QueryJob has `cache_hit: true` and `status: "complete"` on cache hit
- [ ] creates Query record with `domain` from adapter config
- [ ] stores `country_code` on Query record
- [ ] calls `evolveSchema` with adapter's `tableName`
- [ ] returns stored rows, not raw API response
- [ ] `latitude` and `longitude` are numbers on returned results
- [ ] writes QueryCache row on cache miss
- [ ] QueryJob updated to `status: "complete"` with timings on success
- [ ] QueryJob updated to `status: "error"` on fetchData failure
- [ ] returns 500 when fetchData throws

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: query pipeline — intent routing, query cache, job tracking, timings"`
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
  - show `"(cached)"` badge when execute response returns a cache hit
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

- [ ] commit with message `"feat: frontend — single-step flow, real map, interpretation banner, cache badge"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 13 — adding a new domain (walkthrough)

### branch: `feat/domain-<n>`

This step documents the pattern for adding any new domain. No existing files are modified.

#### example: weather domain

- [ ] create `apps/orchestrator/src/domains/configs/weather.json`:
  ```json
  {
    "name": "weather",
    "tableName": "weather_results",
    "prismaModel": "weatherResult",
    "countries": [],
    "intents": ["weather"],
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
  > **`countries: []` + `intents: ["weather"]`:** the empty countries array means this adapter activates for weather queries in any country. `getDomainForQuery` matches on intent when no country restriction is set. This resolves the v4.0 issue where `countries: []` had no defined routing behaviour.

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
  - [ ] Prisma Studio: `QueryJob` row has `status: "complete"`, `fetch_ms` and `store_ms` populated, `cache_hit: false`

**cache hit — repeat query**
- [ ] run the same Cambridge burglaries query a second time
  - [ ] response is noticeably faster
  - [ ] interpretation banner shows `"(cached)"` badge
  - [ ] Prisma Studio: second `QueryJob` row has `cache_hit: true`, `rows_inserted: 0`
  - [ ] server logs show `{ event: "execute", cache_hit: true, ... }`

**geocoder cache**
- [ ] query: `anti-social behaviour in Cambridge in February 2024`
  - [ ] Prisma Studio: `GeocoderCache` still shows only one row for Cambridge
  - [ ] server logs confirm geocode step was skipped

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

**observability log check**
- [ ] confirm server stdout emits one JSON log line per execute call
- [ ] cache miss lines include `fetch_ms`, `store_ms`, `rows_inserted`
- [ ] cache hit lines include `cache_hit: true` with no `fetch_ms`
- [ ] error lines include `event: "execute_error"` and `error` message

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
            GeocoderCache lookup first (normalised lowercase key)
            Cache hit (poly present) → return immediately
            Cache miss → Nominatim + PostGIS, write cache row
            Returns poly, display_name, country_code
       └─ crime/intent.ts — deriveVizHint()
       └─ Returns { plan, poly, viz_hint, resolved_location, country_code, intent, months }
            No database write — frontend calls execute immediately

     POST /query/execute — runs on confirmed plan
       └─ domains/registry.ts — getDomainForQuery(country_code, intent)
            Matches on BOTH country and intent
            Returns 400 "unsupported_region" if none found
       └─ QueryCache lookup — hash(domain + category + dates + resolved_location)
            Cache hit → return stored results, write QueryJob (cache_hit: true), done
            Cache miss → continue to live execution
       └─ adapter.fetchData(plan, locationArg)
            Crime-UK: sequential per-month Police API calls
            Future domains: generic fetcher driven by DomainConfig
       └─ schema.ts — evolveSchema(prisma, tableName, sampleRow, id, domain)
            Table-name and domain aware
            Column name validated against safe regex before ALTER TABLE
            SchemaVersion audit record per new column
       └─ adapter.storeResults(queryId, rows, prisma)
            Filters to live column set before writing
            raw JSONB preserves full API response
       └─ QueryCache write — stores flattened results for future cache hits
       └─ QueryJob update — status, timings, row count, cache_hit flag
       └─ Structured JSON log — event, domain, fetch_ms, store_ms, rows_inserted
       └─ prisma[model].findMany({ where: { query_id } })
            Returns stored rows with flattened lat/lon
            Frontend always receives typed, top-level fields

     Frontend
       └─ parse + execute called back-to-back, no confirmation click
       └─ InterpretationBanner shows plan, "(cached)" badge on cache hit
       └─ MapView: MapLibre + deck.gl, three render modes
       └─ BarChart: monthly counts
       └─ TableView: capped at 50 rows
```

**key principles:**
- Zod is the single source of truth for types across the entire stack.
- The LLM only extracts intent from natural language — it never produces coordinates, viz hints, or relative dates.
- `POST /query/parse` and `POST /query/execute` are separate endpoints called back-to-back. Parse is free of side effects; the frontend shows results immediately without a confirmation click.
- Domain routing is driven by both `country_code` and `intent` — a single country can support multiple domains (crime, weather, transport) without ambiguity.
- The geocoder cache eliminates repeated Nominatim + PostGIS calls. Most sessions reuse a small set of place names.
- The query cache eliminates repeated external API calls for identical queries. Cache keys are deterministic hashes of the normalised plan.
- `QueryJob` provides a queryable audit log of every execution: timings, row counts, cache hits, errors. No external infrastructure required.
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
| inspect query jobs | `npm run db:studio` → QueryJob table |
| inspect query cache | `npm run db:studio` → QueryCache table |
| inspect geocoder cache | `npm run db:studio` → GeocoderCache table |
