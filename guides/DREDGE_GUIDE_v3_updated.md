# dredge — implementation guide v3.1 (multi-domain ready)

---

## what changed from earlier versions

- **app renamed** — query-os is now dredge
- **LLM never produces coordinates** — intent parser returns a place name only; Nominatim resolves it to a polygon
- **shared schemas package** — Zod schemas live in `packages/schemas` as a single source of truth across the entire stack
- **Zod replaces LLM for type inference** — schema evolution infers Postgres column types from Zod's own type system, not an LLM call
- **Zod validates at every boundary** — request body, LLM response, Nominatim response, Police API response, pre-insert records, outbound response, and frontend component boundary
- **`passthrough()` on Police API schema** — unknown fields are preserved rather than stripped, feeding schema evolution
- **`raw JSONB` column** — every full API response is stored regardless of schema state
- **schema evolution handles all new columns** — loops over every new key, not just the first
- **store writes dynamically** — queries live column set before inserting, never writes to columns that don't exist yet
- **DeepSeek** used for all LLM calls (`deepseek-chat` model via `https://api.deepseek.com`)

## what changed from v3 (forward-compatibility additions)

- **crime pipeline in subdirectory** — `src/crime/` rather than flat `src/`, so adding future domains is purely additive
- **schema evolution is table-name aware** — `evolveSchema` and `getCurrentColumns` accept a `tableName` parameter instead of hardcoding `crime_results`
- **`domain` field on `Query` model** — defaults to `"crime"`, ready for multi-domain routing without a migration later
- **`domain` field on `SchemaVersion` model** — audit records track which domain triggered each column addition
- **`geocodeToCoordinates` exported alongside `geocodeToPolygon`** — Nominatim already returns lat/lon; exposing it now costs nothing and is required by all future domains
- **`CoordinatesSchema` in shared schemas** — validates `{ lat, lon }` shape, ready for weather/traffic/events fetchers

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

This package is the single source of truth for all types across orchestrator, frontend, and database. Nothing defines its own Zod schemas — they all import from here.

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
- [ ] define `VizHintSchema` — enum of `"map" | "bar" | "table"`
- [ ] define `QueryPlanSchema` — category, date (`YYYY-MM`), location (place name string, **not coordinates**), viz_hint
- [ ] define `PoliceCrimeSchema` with `.passthrough()` — known fields typed, unknown fields preserved
- [ ] define `CrimeResultSchema` — all database fields including `raw` as `z.unknown()`

#### shared utility schemas

- [ ] define `NominatimResponseSchema` — array of hits each with `boundingbox` and `display_name`
- [ ] define `CoordinatesSchema` — validates `{ lat: number, lon: number, display_name: string }` shape
  > **forward-compatibility note:** not used by crime domain but required by all future domains (weather, traffic, events). Expose it now so adding those domains is purely additive.
- [ ] define `PolygonSchema` — validates `"lat,lng:lat,lng"` format, max 100 points
- [ ] define `PostgresColumnType` — allowed types: `text`, `integer`, `bigint`, `boolean`, `double precision`, `jsonb`, `timestamptz`
- [ ] define `AddColumnSchema` — validates schema evolution op shape
- [ ] define `SchemaOp` type — `{ op: "USE_EXISTING" }` | `z.infer<typeof AddColumnSchema>`

- [ ] export all schemas and their inferred TypeScript types
- [ ] build package to verify compilation:
  ```bash
  npm run build --workspace=packages/schemas
  ```
- [ ] commit with message `"feat: central zod schemas as single source of truth"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 2 — database schema

### branch: `feat/database-schema`

- [ ] open `packages/database/prisma/schema.prisma`

#### query model

- [ ] define `Query` model:
  - `id`, `text`, `category`, `date`, `poly`, `viz_hint`, `createdAt`
  - `domain String @default("crime")` — defaults to crime; ready for multi-domain routing without a future migration
  - relation to `CrimeResult[]`

  > **forward-compatibility note:** adding `domain` now with a default means no migration is needed on a populated table when additional domains are introduced.

#### crime result model

- [ ] define `CrimeResult` model:
  - `id`, `query_id`, `persistent_id`, `category`, `month`
  - `street`, `latitude` (Float), `longitude` (Float)
  - `outcome_category`, `outcome_date`
  - `location_type`, `context`
  - `raw Json?` — stores full API response as JSONB

  > **convention:** every domain result table must have a `raw Json?` column. Establish this as a rule now so it is never forgotten when adding future domains.

#### schema version model

- [ ] define `SchemaVersion` model:
  - `id`, `table_name`, `column_name`, `column_type`, `triggered_by`, `createdAt`
  - `domain String @default("crime")` — tracks which domain triggered each column addition

  > **forward-compatibility note:** adding `domain` now makes the audit log useful across all future domains without a migration.

- [ ] open `packages/database/index.ts` and export `PrismaClient`
- [ ] start Docker:
  ```bash
  docker compose up -d
  ```
- [ ] run initial migration:
  ```bash
  npm run db:migrate
  # name the migration: initial
  ```
- [ ] open Prisma Studio and verify:
  ```bash
  npm run db:studio
  ```
- [ ] confirm `Query`, `CrimeResult`, and `SchemaVersion` tables exist
- [ ] confirm `Query` has `domain` column defaulting to `"crime"`
- [ ] confirm `CrimeResult` has `raw` column of type `Json`
- [ ] confirm `SchemaVersion` has `domain` column defaulting to `"crime"`
- [ ] commit with message `"feat: initial prisma schema — domain-aware, raw jsonb"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 3 — database singleton

### branch: `feat/db-singleton`

- [ ] create `apps/orchestrator/src/db.ts`
- [ ] import `PrismaClient` from database package
- [ ] attach to `globalThis` to survive hot reloads in development
- [ ] export single `prisma` instance

**tests** — `apps/orchestrator/src/__tests__/db.test.ts`
- [ ] prisma instance is defined
- [ ] same instance is returned on multiple imports (singleton behaviour confirmed)

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: prisma singleton"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 4 — express server

### branch: `feat/express-server`

- [ ] create `apps/orchestrator/src/index.ts`
- [ ] load `dotenv/config` — no `console.log` of key material under any circumstances
- [ ] create express app
- [ ] add `cors()` middleware
- [ ] add `express.json()` middleware
- [ ] mount `queryRouter` on `/query` — comment out until step 10
- [ ] implement `GET /health` → `{ status: "ok", timestamp: new Date().toISOString() }`
- [ ] `app.listen(PORT)` where `PORT` defaults to `3001`

**tests** — `apps/orchestrator/src/__tests__/index.test.ts`
- [ ] `GET /health` returns status 200
- [ ] `GET /health` body contains `{ status: "ok" }`
- [ ] `GET /health` body contains a `timestamp` field
- [ ] timestamp is a valid ISO 8601 string

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: express server with health endpoint"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 5 — intent parser

### branch: `feat/intent-parser`

> **structure note:** create this file at `apps/orchestrator/src/crime/intent.ts`, not `src/intent.ts`. The crime subdirectory pattern means adding a `src/weather/` or `src/traffic/` directory later is purely additive with no refactoring of existing import paths.

- [ ] create `apps/orchestrator/src/crime/intent.ts`
- [ ] import `QueryPlanSchema` and `QueryPlan` from `@dredge/schemas`
- [ ] configure DeepSeek client:
  ```ts
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com",
  });
  ```
- [ ] build system prompt — rules to enforce:
  - return JSON only, no prose, no markdown fences
  - `location` must be a descriptive place name, **never coordinates**
  - default `location` to `"Cambridge, UK"` when none specified
  - default `category` to `"all-crime"` when intent is unclear
  - default `date` to most recent full month in `YYYY-MM` format
  - list all valid category slugs with descriptions
- [ ] implement `stripFences(text)` to remove ` ```json ` wrappers from LLM output
- [ ] implement `parseIntent(rawText): Promise<QueryPlan>`:
  - throw `"Query text must not be empty"` on blank input
  - call DeepSeek with system prompt + user message, `max_tokens: 256`
  - strip fences, parse JSON
  - validate with `QueryPlanSchema.safeParse()`
  - throw `"Missing required fields"` when category/date/location/viz_hint absent
  - throw `"Invalid viz_hint"` when viz_hint is present but not map/bar/table
  - throw with Zod issue messages for other validation failures
- [ ] create `apps/orchestrator/src/crime/index.ts` — export `parseIntent` and any other crime pipeline functions

**tests** — `apps/orchestrator/src/__tests__/crime/intent.test.ts`
- [ ] mock the DeepSeek/OpenAI client
- [ ] returns a valid `QueryPlan` with all four fields present: category, date, location, viz_hint
- [ ] `poly` is **not** present on the returned plan
- [ ] `location` is a string place name, never a coordinate string
- [ ] defaults `category` to `"all-crime"` when not mentioned
- [ ] extracts `date` in `YYYY-MM` format
- [ ] defaults `location` to `"Cambridge, UK"` when no location given
- [ ] defaults `date` to most recent full month when not specified
- [ ] strips markdown fences before parsing JSON
- [ ] throws `"Missing required fields"` when LLM omits a required field
- [ ] throws `"Invalid viz_hint"` when viz_hint is not map/bar/table
- [ ] throws on malformed JSON response from LLM
- [ ] throws `"Query text must not be empty"` on blank input

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: crime intent parser — location name only, no coordinates"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 6 — geocoder

### branch: `feat/geocoder`

- [ ] create `apps/orchestrator/src/geocoder.ts`
- [ ] import `NominatimResponseSchema`, `CoordinatesSchema`, and `PolygonSchema` from `@dredge/schemas`
- [ ] implement `geocodeToPolygon(location: string): Promise<string>`:
  - call `https://nominatim.openstreetmap.org/search`
  - params: `{ q: location, format: "json", limit: 1 }`
  - set `User-Agent: "dredge/1.0"` header — Nominatim requires this
  - validate response with `NominatimResponseSchema.parse()`
  - throw `"Could not geocode: <location>"` if result array is empty
  - extract `boundingbox`: `[south, north, west, east]` — all values are strings, parse to numbers
  - convert to Police API poly format:
    ```
    "north,west:north,east:south,east:south,west"
    ```
  - validate final string with `PolygonSchema.parse()` before returning
  - throws if polygon exceeds 100 points
- [ ] implement `geocodeToCoordinates(location: string): Promise<{ lat: number, lon: number, display_name: string }>`:
  - same Nominatim call and validation as above
  - extract `lat`, `lon`, `display_name` from first result — parse lat/lon to numbers
  - validate result with `CoordinatesSchema.parse()` before returning

  > **forward-compatibility note:** `geocodeToCoordinates` is not used by the crime pipeline but is required by all future domains (weather, traffic, events). The Nominatim call and caching logic is shared — exposing it now means no duplication later.

**tests** — `apps/orchestrator/src/__tests__/geocoder.test.ts`
- [ ] mock axios
- [ ] `geocodeToPolygon` calls Nominatim with correct `q` parameter
- [ ] `geocodeToPolygon` calls Nominatim with `format: "json"` and `limit: 1`
- [ ] `geocodeToPolygon` sets `User-Agent: "dredge/1.0"` header
- [ ] `geocodeToPolygon` returns a valid poly string in `"lat,lng:lat,lng"` format
- [ ] `geocodeToPolygon` returned poly has exactly 4 points for a bounding box result
- [ ] `geocodeToPolygon` all coordinate values in the output are numeric (not raw strings)
- [ ] `geocodeToPolygon` north/south and east/west values are in correct positions
- [ ] `geocodeToPolygon` throws `"Could not geocode: <location>"` when result array is empty
- [ ] `geocodeToCoordinates` returns valid `{ lat, lon, display_name }` object
- [ ] `geocodeToCoordinates` lat and lon are numbers, not strings
- [ ] `geocodeToCoordinates` throws `"Could not geocode: <location>"` when result array is empty
- [ ] both functions validate response with `NominatimResponseSchema`

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: geocoder — polygon and coordinates, shared nominatim call"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 7 — api fetcher

### branch: `feat/api-fetcher`

> **structure note:** create this file at `apps/orchestrator/src/crime/fetcher.ts`.

- [ ] create `apps/orchestrator/src/crime/fetcher.ts`
- [ ] import `PoliceCrimeSchema` and `RawCrime` from `@dredge/schemas`
- [ ] implement `fetchCrimes(plan, poly): Promise<RawCrime[]>`:
  - validate `poly` does not exceed 100 points before calling API
  - call `https://data.police.uk/api/crimes-street/{plan.category}`
  - params: `{ date: plan.date, poly }`
  - validate response array with `z.array(PoliceCrimeSchema).parse()`
  - `PoliceCrimeSchema` uses `.passthrough()` — unknown fields are preserved, not stripped
  - log a warning on validation errors but do not throw — return what was parsed
  - return `RawCrime[]`

**tests** — `apps/orchestrator/src/__tests__/crime/fetcher.test.ts`
- [ ] mock axios
- [ ] calls correct URL with category slug: `crimes-street/burglary`
- [ ] passes `date` param correctly
- [ ] passes `poly` param correctly
- [ ] returns array of `RawCrime` objects
- [ ] unknown fields on crime objects are preserved in the returned data
- [ ] handles empty array response without throwing
- [ ] throws when polygon exceeds 100 points before making API call

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: police api fetcher with passthrough schema"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 8 — schema evolution

### branch: `feat/schema-evolution`

Schema evolution no longer calls an LLM to guess column types. Zod's own type system infers the correct Postgres type deterministically.

- [ ] create `apps/orchestrator/src/schema.ts`
- [ ] import `PostgresColumnType`, `AddColumnSchema`, `SchemaOp` from `@dredge/schemas`
- [ ] implement `getCurrentColumns(prisma, tableName: string): Promise<string[]>` — queries `information_schema.columns` for the given table name
  > **forward-compatibility note:** `tableName` is a parameter, not hardcoded. The same function works for `crime_results`, `weather_results`, or any future domain table.
- [ ] implement `findNewKeys(sampleRow, existingColumns)` — diffs object keys against existing column set
- [ ] implement `inferPostgresType(value: unknown): PostgresColumnType` — Zod-based type mapping:
  ```
  string             → "text"
  number (integer)   → "integer"
  number (decimal)   → "double precision"
  boolean            → "boolean"
  object/array       → "jsonb"
  null/undefined     → "text"  (safe default)
  ```
- [ ] implement `evolveSchema(prisma, tableName: string, sampleRow, triggeredBy, domain: string)`:
  - get current columns for the specified `tableName`
  - find new keys
  - if none → return immediately, **no further work**
  - loop over **every** new key:
    - infer Postgres type from sample value
    - build `AddColumnSchema`-validated op object
    - call `applySchemaOp(prisma, op, triggeredBy, tableName, domain)`
- [ ] implement `applySchemaOp(prisma, op, triggeredBy, tableName: string, domain: string)`:
  - if `USE_EXISTING` → return
  - build SQL: `ALTER TABLE "<tableName>" ADD COLUMN "<column>" <type>`
  - validate against safe regex before executing — regex must use the dynamic table name:
    ```
    /^ALTER TABLE "?[a-z_][a-z0-9_]*"? ADD COLUMN "?([a-z_][a-z0-9_]*)"? (text|integer|bigint|boolean|double precision|jsonb|timestamptz)$/i
    ```
  - execute with `prisma.$executeRawUnsafe(sql)`
  - write `SchemaVersion` audit record including `domain` field

**tests** — `apps/orchestrator/src/__tests__/schema.test.ts`
- [ ] mock prisma
- [ ] returns immediately when no new keys found — no SQL executed
- [ ] does not call LLM or any external service when no new keys found
- [ ] infers `"text"` for string values
- [ ] infers `"integer"` for whole number values
- [ ] infers `"double precision"` for decimal number values
- [ ] infers `"boolean"` for boolean values
- [ ] infers `"jsonb"` for object values
- [ ] infers `"jsonb"` for array values
- [ ] infers `"text"` as safe default for null values
- [ ] calls `applySchemaOp` once **per new key** when multiple new keys present
- [ ] `applySchemaOp` does nothing on `USE_EXISTING`
- [ ] `applySchemaOp` executes correct ALTER TABLE SQL for a valid op against `crime_results`
- [ ] `applySchemaOp` executes correct ALTER TABLE SQL for a valid op against a different table name
- [ ] `applySchemaOp` rejects SQL containing semicolons
- [ ] `applySchemaOp` rejects SQL containing DROP or other unsafe keywords
- [ ] `applySchemaOp` writes one `SchemaVersion` record per column added, including `domain` field
- [ ] `evolveSchema` writes a `SchemaVersion` record for each of multiple new columns

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: schema evolution — table-name aware, domain-aware audit"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 9 — store

### branch: `feat/store`

> **structure note:** create this file at `apps/orchestrator/src/crime/store.ts`.

- [ ] create `apps/orchestrator/src/crime/store.ts`
- [ ] import `CrimeResultSchema` and `RawCrime` from `@dredge/schemas`
- [ ] implement `flattenCrime(crime: RawCrime): Record<string, unknown>`:
  - `category`, `month` from top level
  - `street` from `crime.location.street.name`
  - `latitude` as `parseFloat(crime.location.latitude)`
  - `longitude` as `parseFloat(crime.location.longitude)`
  - `outcome_category` from `crime.outcome_status?.category ?? null`
  - `outcome_date` from `crime.outcome_status?.date ?? null`
  - `location_type`, `context` from top level
  - `raw: crime` — full original object preserved
  - spread any unknown top-level fields that are not in the known set
- [ ] implement `storeResults(queryId, crimes, prisma)`:
  - if empty array → return without calling prisma
  - query `information_schema.columns` to get current column set for `crime_results`
  - flatten each crime with `flattenCrime`
  - for each row, filter to only keys present in the current schema
  - validate each record with `CrimeResultSchema.partial().safeParse()` — log warnings, don't throw
  - batch insert with `prisma.$transaction`

**tests** — `apps/orchestrator/src/__tests__/crime/store.test.ts`
- [ ] mock prisma
- [ ] calls `prisma.$transaction` with the correct number of create operations
- [ ] `latitude` is stored as a float, not a string
- [ ] `longitude` is stored as a float, not a string
- [ ] `raw` field contains the full original crime object
- [ ] only writes columns that currently exist in the schema (dynamic filter confirmed)
- [ ] a column that exists in the crime object but not in the schema is silently dropped
- [ ] a new column that was added by schema evolution in the same request is written correctly
- [ ] unknown top-level fields on the crime object are included in the flattened row
- [ ] does not call `prisma.$transaction` when crimes array is empty

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: dynamic crime store with raw jsonb preservation"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 10 — query pipeline

### branch: `feat/query-pipeline`

- [ ] create `apps/orchestrator/src/query.ts`
- [ ] import all relevant schemas from `@dredge/schemas`
- [ ] import crime pipeline functions from `./crime`
- [ ] define request body schema with Zod: `{ text: z.string().min(1) }`
- [ ] create express `Router`, export as `queryRouter`
- [ ] implement `POST /`:
  - [ ] validate `req.body` with Zod at the boundary — return 400 with Zod error details on failure
  - [ ] call `parseIntent(text)`
  - [ ] call `geocodeToPolygon(plan.location)` to resolve poly string
  - [ ] create `Query` record in postgres, storing the resolved `poly` and `domain: "crime"`
  - [ ] call `fetchCrimes(plan, poly)`
  - [ ] if crimes returned, build `sampleRow` from first crime and call `evolveSchema(prisma, "crime_results", sampleRow, queryRecord.id, "crime")`
  - [ ] do **not** call `evolveSchema` if crimes array is empty
  - [ ] call `storeResults(queryRecord.id, crimes, prisma)`
  - [ ] validate outbound response shape with Zod before sending
  - [ ] return `{ query_id, plan, poly, count, viz_hint, results }` — cap results at 100
  - [ ] catch all errors — Zod errors return 400, all others return 500
- [ ] implement `GET /:id`:
  - [ ] `prisma.query.findUnique` with `include: { results: true }`
  - [ ] return 404 if not found
- [ ] uncomment `queryRouter` import in `index.ts`

**tests** — `apps/orchestrator/src/__tests__/query.test.ts`
- [ ] mock all dependencies: parseIntent, geocodeToPolygon, fetchCrimes, evolveSchema, storeResults, prisma
- [ ] `POST /` returns 400 when `text` field is missing from body
- [ ] `POST /` returns 400 when `text` is an empty string
- [ ] `POST /` returns 400 with Zod error details when body is invalid
- [ ] `POST /` calls `parseIntent` with trimmed text
- [ ] `POST /` calls `geocodeToPolygon` with the `location` string from the plan
- [ ] `POST /` calls `fetchCrimes` with the resolved `poly`, not the location name
- [ ] `POST /` calls `evolveSchema` with `"crime_results"` and `"crime"` arguments when crimes array is non-empty
- [ ] `POST /` does **not** call `evolveSchema` when crimes array is empty
- [ ] `POST /` calls `storeResults` with correct queryId and full crimes array
- [ ] `POST /` response includes `query_id`, `plan`, `poly`, `count`, `viz_hint`, `results`
- [ ] `POST /` caps `results` at 100 items even when more are returned
- [ ] `POST /` returns 500 when `parseIntent` throws
- [ ] `POST /` returns 500 when `geocodeToPolygon` throws
- [ ] `POST /` returns 500 when `fetchCrimes` throws
- [ ] `GET /:id` returns 404 for an unknown id
- [ ] `GET /:id` returns the query record with results included

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: query pipeline with zod at all boundaries"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 11 — frontend

### branch: `feat/frontend`

- [ ] import `QueryPlanSchema` and response schemas from `@dredge/schemas` into web app
- [ ] implement `apps/web/src/App.tsx`:
  - `useState` for `result`, `loading`, `error`
  - `handleQuery(text)` → `POST /query` → validate response with Zod → set result
  - show Zod validation error in red if response shape is unexpected
  - render `<QueryInput>` and `<ResultRenderer>`
- [ ] implement `apps/web/src/components/QueryInput.tsx`:
  - controlled input
  - submit on enter or button click
  - disable input and button while loading
- [ ] implement `apps/web/src/components/ResultRenderer.tsx`:
  - summary line: count, category, date, resolved location
  - render map when `viz_hint === "map"`
  - render bar chart when `viz_hint === "bar"`
  - render table when `viz_hint === "table"`
  - table columns: category | street | month | outcome
  - cap table at 50 rows
  - show error message in red if Zod boundary validation fails

- [ ] commit with message `"feat: frontend with zod response validation"`
- [ ] push branch, open pull request, merge, delete branch

---

## smoke tests

```bash
git checkout main && git pull
npm run dev
```

- [ ] open `http://localhost:3000`
- [ ] query: `show me burglaries in Cambridge in January 2024`
  - [ ] orchestrator logs show geocoder resolving "Cambridge, UK" to a bounding box
  - [ ] results table renders with street names and months
- [ ] query: `what were the outcomes of drug offences in Camden last month`
  - [ ] location "Camden, London" resolves correctly via Nominatim
  - [ ] category maps to `drugs`
- [ ] query: `show me all crime in SW1A` — tests postcode resolution
  - [ ] poly returned, crimes load correctly
- [ ] open Prisma Studio:
  ```bash
  npm run db:studio
  ```
  - [ ] `SchemaVersion` table shows records for any evolved columns, with `domain: "crime"`
  - [ ] `CrimeResult` rows have `raw` column populated with full JSON
  - [ ] `Query` rows have `domain: "crime"` populated
  - [ ] if Police API returned any new fields, corresponding columns appear in `CrimeResult`

---

## coverage check

```bash
npm run test:coverage --workspace=apps/orchestrator
```

- [ ] all tests passing
- [ ] line coverage above 80%
- [ ] branch coverage above 70%

```bash
git add .
git commit -m "chore: confirm test coverage"
git push origin main
```

---

## architecture

```
User text
  └─ Zod validates request body at API boundary
       └─ crime/intent.ts — parseIntent()
            DeepSeek infers: category, date, location (place name), viz_hint
            Zod validates LLM output against QueryPlanSchema
       └─ geocoder.ts — geocodeToPolygon()
            Nominatim resolves place name → bounding box poly
            Zod validates Nominatim response and final polygon format
            geocodeToCoordinates() also available for future domains
       └─ crime/fetcher.ts — fetchCrimes()
            Police API returns crimes within poly
            Zod validates response with passthrough — unknown fields preserved
       └─ schema.ts — evolveSchema(prisma, tableName, sampleRow, triggeredBy, domain)
            Table-name aware — works for any domain result table
            Zod type inference maps new field values → Postgres column types
            No LLM call — deterministic, fast, free
            Writes SchemaVersion audit record with domain field
       └─ crime/store.ts — storeResults()
            Queries live column set before writing
            Zod validates each record before insert
            raw JSONB preserves full API response
       └─ Response validated with Zod before sending
            └─ Frontend validates response at component boundary
```

**key principles:**
- Zod is the single source of truth for types across the entire stack. Every system boundary is validated. The LLM only does what LLMs are good at: extracting intent from natural language.
- Crime pipeline lives in `src/crime/` — adding a new domain is purely additive, never a refactor.
- Schema evolution is table-name and domain aware from day one — no migration needed when new domains arrive.
- Every result table has a `raw Json?` column — no data is ever lost regardless of schema state.

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
