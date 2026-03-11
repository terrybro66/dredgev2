# dredge — implementation guide v3.2

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

## what changed from v3.1 (forward-compatibility additions)

- **crime pipeline in subdirectory** — `src/crime/` rather than flat `src/`, so adding future domains is purely additive
- **schema evolution is table-name aware** — `evolveSchema` and `getCurrentColumns` accept a `tableName` parameter instead of hardcoding `crime_results`
- **`domain` field on `Query` model** — defaults to `"crime"`, ready for multi-domain routing without a migration later
- **`domain` field on `SchemaVersion` model** — audit records track which domain triggered each column addition
- **`geocodeToCoordinates` exported alongside `geocodeToPolygon`** — Nominatim already returns lat/lon; exposing it now costs nothing and is required by all future domains
- **`CoordinatesSchema` in shared schemas** — validates `{ lat, lon }` shape, ready for weather/traffic/events fetchers

## what changed from v3.1 (query input improvements)

- **date ranges replace single month** — `QueryPlanSchema` uses `date_from` and `date_to` (`YYYY-MM`); the fetcher expands the range into sequential per-month API calls; relative expressions like "last 3 months" resolve at parse time
- **deterministic viz hint** — viz hint is derived from the resolved query shape after parsing, not guessed by the LLM; the LLM output field is removed from `QueryPlanSchema`
- **intent confirmation endpoint** — `POST /query/parse` returns the interpreted plan and resolved location for frontend confirmation before execution; `POST /query/execute` runs the confirmed plan
- **richer error payloads** — parse failures return `{ error, understood, missing, message }` so the frontend can show what was captured and what was not, rather than a generic error string

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
- [ ] define `VizHint` type — `"map" | "bar" | "table"` — **not a schema field on QueryPlan**; derived deterministically after parsing (see viz hint rules below)
- [ ] define `QueryPlanSchema` — category, date_from (`YYYY-MM`), date_to (`YYYY-MM`), location (place name string, **not coordinates**)
  > **date range note:** `date_from` and `date_to` replace the single `date` field. When the user specifies one month, `date_from` and `date_to` are the same value. When they say "last 3 months", the LLM resolves both values at parse time to explicit `YYYY-MM` strings. The fetcher then expands the range into sequential per-month API calls.
- [ ] define `ParsedQuerySchema` — extends `QueryPlanSchema`, adds `viz_hint` (derived), `resolved_location` (display name from geocoder), `months` (array of `YYYY-MM` strings expanded from range)
  > **viz hint rules** — derived from query shape after parsing, never from the LLM:
  > - single month + single location → `"map"`
  > - multiple months, any location → `"bar"` (trend over time)
  > - any query where category is `"all-crime"` and range > 1 month → `"bar"`
  > - explicit "list", "show me", "what are" phrasing → `"table"`
  > - default → `"map"`
- [ ] define `IntentErrorSchema` — structured error shape for parse failures:
  ```ts
  {
    error: "incomplete_intent" | "invalid_intent" | "geocode_failed",
    understood: Partial<QueryPlan>,   // fields successfully parsed
    missing: string[],                // field names that could not be determined
    message: string                   // human-readable explanation
  }
  ```
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
- [ ] commit with message `"feat: central zod schemas — date ranges, intent error shape, derived viz hint"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 2 — database schema

### branch: `feat/database-schema`

- [ ] open `packages/database/prisma/schema.prisma`

#### query model

- [ ] define `Query` model:
  - `id`, `text`, `category`, `date_from`, `date_to`, `poly`, `viz_hint`, `createdAt`
  - `domain String @default("crime")` — defaults to crime; ready for multi-domain routing without a future migration
  - `resolved_location String?` — display name from geocoder, stored for frontend confirmation and result summaries
  - relation to `CrimeResult[]`

  > **forward-compatibility note:** adding `domain` now with a default means no migration is needed on a populated table when additional domains are introduced. `resolved_location` makes confirmation responses self-contained without re-calling Nominatim.

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
- [ ] confirm `Query` has `date_from`, `date_to`, and `resolved_location` columns
- [ ] confirm `CrimeResult` has `raw` column of type `Json`
- [ ] confirm `SchemaVersion` has `domain` column defaulting to `"crime"`
- [ ] commit with message `"feat: initial prisma schema — domain-aware, date ranges, raw jsonb"`
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
- [ ] import `QueryPlanSchema`, `QueryPlan`, `IntentErrorSchema` from `@dredge/schemas`
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
  - resolve `date_from` and `date_to` as explicit `YYYY-MM` values — never pass relative expressions through:
    - "last month" → previous full calendar month
    - "last 3 months" → `date_from` = 3 months ago, `date_to` = last full month
    - "last year" → `date_from` = 12 months ago, `date_to` = last full month
    - "in January 2024" → `date_from: "2024-01"`, `date_to: "2024-01"`
    - when no date mentioned → default to last full month for both
  - do **not** include `viz_hint` in output — this is derived after parsing
  - list all valid category slugs with descriptions
- [ ] implement `stripFences(text)` to remove ` ```json ` wrappers from LLM output
- [ ] implement `deriveVizHint(plan: QueryPlan, rawText: string): VizHint`:
  - compare `date_from` and `date_to` — if different, return `"bar"`
  - if category is `"all-crime"` and date range spans more than 1 month, return `"bar"`
  - if raw text contains any of: "list", "show me", "what are", "details", "table" → return `"table"`
  - default → return `"map"`
- [ ] implement `expandDateRange(date_from: string, date_to: string): string[]` — returns ordered array of all `YYYY-MM` months between and including from/to
- [ ] implement `parseIntent(rawText: string): Promise<QueryPlan>`:
  - throw `"Query text must not be empty"` on blank input
  - call DeepSeek with system prompt + user message, `max_tokens: 256`
  - strip fences, parse JSON
  - validate with `QueryPlanSchema.safeParse()`
  - on failure, construct and throw `IntentError`:
    - populate `understood` with whichever fields parsed successfully
    - populate `missing` with field names that failed validation
    - throw with structured error — do not throw a plain string
  - on success, return validated plan
- [ ] create `apps/orchestrator/src/crime/index.ts` — export `parseIntent`, `deriveVizHint`, `expandDateRange`

**tests** — `apps/orchestrator/src/__tests__/crime/intent.test.ts`
- [ ] mock the DeepSeek/OpenAI client
- [ ] returns a valid `QueryPlan` with fields: category, date_from, date_to, location
- [ ] `viz_hint` is **not** present on the returned plan — it is derived separately
- [ ] `poly` is **not** present on the returned plan
- [ ] `location` is a string place name, never a coordinate string
- [ ] defaults `category` to `"all-crime"` when not mentioned
- [ ] resolves "last month" to correct `date_from` and `date_to` values
- [ ] resolves "last 3 months" to correct `date_from` and `date_to` values
- [ ] resolves "last year" to 12-month range
- [ ] resolves single month "January 2024" to identical `date_from` and `date_to`
- [ ] defaults both date fields to last full month when no date mentioned
- [ ] defaults `location` to `"Cambridge, UK"` when no location given
- [ ] strips markdown fences before parsing JSON
- [ ] on missing `location` field — throws structured IntentError with `missing: ["location"]`
- [ ] on missing `category` field — throws structured IntentError with `missing: ["category"]`
- [ ] on multiple missing fields — all missing field names present in `understood` and `missing`
- [ ] successfully parsed fields appear in `understood` even when other fields fail
- [ ] throws on malformed JSON response from LLM
- [ ] throws `"Query text must not be empty"` on blank input

**tests** — `deriveVizHint`
- [ ] returns `"map"` for single-month single-location query
- [ ] returns `"bar"` when `date_from` !== `date_to`
- [ ] returns `"bar"` when category is `"all-crime"` and range > 1 month
- [ ] returns `"table"` when raw text contains "list"
- [ ] returns `"table"` when raw text contains "show me"
- [ ] returns `"table"` when raw text contains "details"
- [ ] returns `"map"` as default when no rule matches

**tests** — `expandDateRange`
- [ ] same month → returns array with one entry
- [ ] two adjacent months → returns both in order
- [ ] 3-month range → returns all three months in ascending order
- [ ] 12-month range → returns 12 entries
- [ ] `date_to` earlier than `date_from` → throws

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: crime intent parser — date ranges, derived viz hint, structured errors"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 6 — geocoder

### branch: `feat/geocoder`

- [ ] create `apps/orchestrator/src/geocoder.ts`
- [ ] import `NominatimResponseSchema`, `CoordinatesSchema`, and `PolygonSchema` from `@dredge/schemas`
- [ ] implement `geocodeToPolygon(location: string): Promise<{ poly: string, display_name: string }>`:
  - call `https://nominatim.openstreetmap.org/search`
  - params: `{ q: location, format: "json", limit: 1 }`
  - set `User-Agent: "dredge/1.0"` header — Nominatim requires this
  - validate response with `NominatimResponseSchema.parse()`
  - throw structured error `{ error: "geocode_failed", message: "Could not geocode: <location>", understood: {}, missing: ["location"] }` if result array is empty
  - extract `boundingbox`: `[south, north, west, east]` — all values are strings, parse to numbers
  - convert to Police API poly format: `"north,west:north,east:south,east:south,west"`
  - validate final string with `PolygonSchema.parse()` before returning
  - return `{ poly, display_name }` — `display_name` is stored on the Query record and used in confirmation responses
- [ ] implement `geocodeToCoordinates(location: string): Promise<{ lat: number, lon: number, display_name: string }>`:
  - same Nominatim call and validation as above
  - extract `lat`, `lon`, `display_name` from first result — parse lat/lon to numbers
  - validate result with `CoordinatesSchema.parse()` before returning

  > **forward-compatibility note:** `geocodeToCoordinates` is not used by the crime pipeline but is required by all future domains (weather, traffic, events). The Nominatim call and caching logic is shared — exposing it now means no duplication later.

  > **display_name note:** `geocodeToPolygon` now returns `display_name` alongside the polygon string. This is what gets stored in `Query.resolved_location` and shown to the user in the confirmation step. "Cambridge, Cambridgeshire, England" is more useful to the user than the coordinates they never typed.

**tests** — `apps/orchestrator/src/__tests__/geocoder.test.ts`
- [ ] mock axios
- [ ] `geocodeToPolygon` calls Nominatim with correct `q` parameter
- [ ] `geocodeToPolygon` calls Nominatim with `format: "json"` and `limit: 1`
- [ ] `geocodeToPolygon` sets `User-Agent: "dredge/1.0"` header
- [ ] `geocodeToPolygon` returns `{ poly, display_name }` object
- [ ] `geocodeToPolygon` returned poly has exactly 4 points for a bounding box result
- [ ] `geocodeToPolygon` all coordinate values in the output are numeric (not raw strings)
- [ ] `geocodeToPolygon` north/south and east/west values are in correct positions
- [ ] `geocodeToPolygon` throws structured IntentError when result array is empty
- [ ] `geocodeToCoordinates` returns valid `{ lat, lon, display_name }` object
- [ ] `geocodeToCoordinates` lat and lon are numbers, not strings
- [ ] `geocodeToCoordinates` throws structured IntentError when result array is empty
- [ ] both functions validate response with `NominatimResponseSchema`

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: geocoder — returns display_name, structured error on failure"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 7 — api fetcher

### branch: `feat/api-fetcher`

> **structure note:** create this file at `apps/orchestrator/src/crime/fetcher.ts`.

- [ ] create `apps/orchestrator/src/crime/fetcher.ts`
- [ ] import `PoliceCrimeSchema` and `RawCrime` from `@dredge/schemas`
- [ ] implement `fetchCrimesForMonth(plan, poly, month: string): Promise<RawCrime[]>`:
  - validate `poly` does not exceed 100 points before calling API
  - call `https://data.police.uk/api/crimes-street/{plan.category}`
  - params: `{ date: month, poly }`
  - validate response array with `z.array(PoliceCrimeSchema).parse()`
  - `PoliceCrimeSchema` uses `.passthrough()` — unknown fields are preserved, not stripped
  - log a warning on validation errors but do not throw — return what was parsed
  - return `RawCrime[]`
- [ ] implement `fetchCrimes(plan, poly): Promise<RawCrime[]>`:
  - expand date range to months array using `expandDateRange(plan.date_from, plan.date_to)`
  - call `fetchCrimesForMonth` for each month **sequentially** — not in parallel, to respect API rate limits
  - merge and return all results as a single flat array

  > **sequential fetch note:** the Police API has no documented rate limit but parallel requests for large date ranges have been observed to fail. Sequential calls are slower but reliable. For a 12-month range this means 12 sequential HTTP calls — set user expectations accordingly in the frontend loading state.

**tests** — `apps/orchestrator/src/__tests__/crime/fetcher.test.ts`
- [ ] mock axios
- [ ] `fetchCrimesForMonth` calls correct URL with category slug
- [ ] `fetchCrimesForMonth` passes `date` param correctly as the month argument
- [ ] `fetchCrimesForMonth` passes `poly` param correctly
- [ ] `fetchCrimesForMonth` returns array of `RawCrime` objects
- [ ] `fetchCrimesForMonth` unknown fields on crime objects are preserved
- [ ] `fetchCrimesForMonth` handles empty array response without throwing
- [ ] `fetchCrimesForMonth` throws when polygon exceeds 100 points
- [ ] `fetchCrimes` calls API once for a single-month range
- [ ] `fetchCrimes` calls API three times for a 3-month range
- [ ] `fetchCrimes` calls API twelve times for a 12-month range
- [ ] `fetchCrimes` merges results from all months into a single array
- [ ] `fetchCrimes` calls months sequentially, not in parallel
- [ ] `fetchCrimes` returns combined results in month-ascending order

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: crime fetcher — multi-month sequential expansion"`
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
- [ ] implement `inferPostgresType(value: unknown): PostgresColumnType` — value-based type mapping:
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
  - validate against safe regex before executing — regex must validate the dynamic table name:
    ```
    /^ALTER TABLE "?[a-z_][a-z0-9_]*"? ADD COLUMN "?([a-z_][a-z0-9_]*)"? (text|integer|bigint|boolean|double precision|jsonb|timestamptz)$/i
    ```
  - execute with `prisma.$executeRawUnsafe(sql)`
  - write `SchemaVersion` audit record including `domain` field

**tests** — `apps/orchestrator/src/__tests__/schema.test.ts`
- [ ] mock prisma
- [ ] returns immediately when no new keys found — no SQL executed
- [ ] does not call any external service when no new keys found
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

The query pipeline is split into two endpoints. `POST /query/parse` interprets the user's text and returns the resolved plan for frontend confirmation. `POST /query/execute` receives a confirmed plan and runs the full data pipeline. This separation ensures the user always sees what the system understood before any API calls are made.

- [ ] create `apps/orchestrator/src/query.ts`
- [ ] import all relevant schemas from `@dredge/schemas`
- [ ] import crime pipeline functions from `./crime`
- [ ] import `deriveVizHint`, `expandDateRange` from `./crime/intent`
- [ ] import `geocodeToPolygon` from `./geocoder`
- [ ] define request body schema with Zod: `{ text: z.string().min(1) }`
- [ ] define execute body schema with Zod: `{ plan: QueryPlanSchema, poly: z.string(), viz_hint: VizHintSchema, resolved_location: z.string() }`
- [ ] create express `Router`, export as `queryRouter`

#### POST /query/parse

- [ ] validate `req.body` with Zod — return 400 with Zod error details on failure
- [ ] call `parseIntent(text)` — on `IntentError`, return 400 with the full structured error payload:
  ```json
  {
    "error": "incomplete_intent",
    "understood": { "category": "burglary", "date_from": "2024-01" },
    "missing": ["location"],
    "message": "Could not determine a location from your query"
  }
  ```
- [ ] call `geocodeToPolygon(plan.location)` — on geocode failure, return 400 with structured error payload
- [ ] derive `viz_hint` from `deriveVizHint(plan, text)`
- [ ] return confirmation payload — **do not write to database yet**:
  ```json
  {
    "plan": { "category", "date_from", "date_to", "location" },
    "poly": "...",
    "viz_hint": "map",
    "resolved_location": "Cambridge, Cambridgeshire, England",
    "months": ["2024-01", "2024-02", "2024-03"]
  }
  ```

#### POST /query/execute

- [ ] validate `req.body` against execute body schema — return 400 on failure
- [ ] create `Query` record in postgres storing `plan`, `poly`, `viz_hint`, `resolved_location`, `domain: "crime"`
- [ ] call `fetchCrimes(plan, poly)` — this expands the date range and fetches all months
- [ ] if crimes returned, build `sampleRow` from first crime and call `evolveSchema(prisma, "crime_results", sampleRow, queryRecord.id, "crime")`
- [ ] do **not** call `evolveSchema` if crimes array is empty
- [ ] call `storeResults(queryRecord.id, crimes, prisma)`
- [ ] validate outbound response shape with Zod before sending
- [ ] return `{ query_id, plan, poly, viz_hint, resolved_location, count, months_fetched, results }` — cap results at 100
- [ ] catch all errors — Zod errors return 400, all others return 500

#### GET /query/:id

- [ ] `prisma.query.findUnique` with `include: { results: true }`
- [ ] return 404 if not found

- [ ] uncomment `queryRouter` import in `index.ts`

**tests** — `apps/orchestrator/src/__tests__/query.test.ts`
- [ ] mock all dependencies: parseIntent, geocodeToPolygon, deriveVizHint, fetchCrimes, evolveSchema, storeResults, prisma

**POST /query/parse tests**
- [ ] returns 400 when `text` field is missing
- [ ] returns 400 when `text` is an empty string
- [ ] returns 400 with structured IntentError when parseIntent throws IntentError
- [ ] structured error includes `understood` and `missing` fields
- [ ] returns 400 with structured error when geocoder fails
- [ ] returns confirmation payload with `plan`, `poly`, `viz_hint`, `resolved_location`, `months`
- [ ] does **not** write to the database
- [ ] does **not** call fetchCrimes
- [ ] `viz_hint` in response is derived, not from LLM
- [ ] `resolved_location` reflects geocoder display_name, not raw location string
- [ ] `months` array is correctly expanded from date range

**POST /query/execute tests**
- [ ] returns 400 when body is missing required fields
- [ ] creates Query record with `domain: "crime"`
- [ ] stores `resolved_location` on Query record
- [ ] calls `fetchCrimes` with the poly from the request body
- [ ] calls `evolveSchema` with `"crime_results"` and `"crime"` when crimes returned
- [ ] does **not** call `evolveSchema` when crimes array is empty
- [ ] response includes `query_id`, `plan`, `poly`, `viz_hint`, `resolved_location`, `count`, `months_fetched`, `results`
- [ ] caps `results` at 100 items
- [ ] returns 500 when `fetchCrimes` throws
- [ ] returns 500 when `storeResults` throws

**GET /query/:id tests**
- [ ] returns 404 for unknown id
- [ ] returns query record with results included

```bash
npm test --workspace=apps/orchestrator
```

- [ ] commit with message `"feat: split query pipeline — parse confirmation + execute"`
- [ ] push branch, open pull request, merge, delete branch

---

## step 11 — frontend

### branch: `feat/frontend`

- [ ] import all relevant schemas from `@dredge/schemas`
- [ ] implement `apps/web/src/App.tsx`:
  - `useState` for `confirmation`, `result`, `loading`, `error`
  - `handleQuery(text)` → `POST /query/parse` → on success set `confirmation`, on IntentError show structured feedback
  - `handleConfirm()` → `POST /query/execute` with confirmed plan → set `result`
  - `handleRefine()` → clear confirmation, return user to input with text pre-populated
  - render `<QueryInput>`, `<IntentConfirmation>` (when confirmation set), `<ResultRenderer>` (when result set)

- [ ] implement `apps/web/src/components/QueryInput.tsx`:
  - controlled input, pre-populated when user refines a previous query
  - submit on enter or button click
  - disable while loading
  - show loading label appropriate to stage: "Interpreting..." during parse, "Fetching data..." during execute

- [ ] implement `apps/web/src/components/IntentConfirmation.tsx`:
  - renders the interpreted plan as a human-readable summary before execution:
    > Searching for **burglaries** in **Cambridge, Cambridgeshire, England** from **January 2024** to **March 2024** — 3 months — visualised as a **bar chart**
  - show "Search" button to proceed to execute
  - show "Refine" button to return to input with text pre-populated
  - if date range spans more than 6 months, show a warning: "This will fetch N months of data and may take a moment"

- [ ] implement `apps/web/src/components/IntentError.tsx`:
  - renders structured parse errors with context:
    - show `understood` fields as green chips — "Got: burglary, January 2024"
    - show `missing` fields as amber chips — "Missing: location"
    - show `message` as plain text explanation
  - show "Try again" link that returns focus to the input

- [ ] implement `apps/web/src/components/ResultRenderer.tsx`:
  - summary line: count, category, date range, resolved location, months fetched
  - render map when `viz_hint === "map"`
  - render bar chart when `viz_hint === "bar"` — x-axis is month, y-axis is count
  - render table when `viz_hint === "table"`
  - table columns: category | street | month | outcome
  - cap table at 50 rows
  - show Zod validation error in red if response shape is unexpected

- [ ] commit with message `"feat: frontend — confirmation step, intent error feedback, date range rendering"`
- [ ] push branch, open pull request, merge, delete branch

---

## smoke tests

```bash
git checkout main && git pull
npm run dev
```

- [ ] open `http://localhost:3000`

**single month query**
- [ ] query: `show me burglaries in Cambridge in January 2024`
  - [ ] confirmation shows: "burglaries in Cambridge, Cambridgeshire, England — January 2024 — map"
  - [ ] confirm → results render as map with street markers
  - [ ] Prisma Studio: Query row has `date_from: "2024-01"`, `date_to: "2024-01"`, `resolved_location` populated

**date range query**
- [ ] query: `show me drug offences in Camden over the last 3 months`
  - [ ] confirmation shows correct 3-month range with derived `bar` viz hint
  - [ ] confirmation warns if range is large
  - [ ] confirm → results render as bar chart with monthly counts
  - [ ] Prisma Studio: Query row has correct `date_from`, `date_to`

**intent error — missing location**
- [ ] query: `show me burglaries last month`
  - [ ] parse returns IntentError with `understood: { category, date_from, date_to }` and `missing: ["location"]`
  - [ ] frontend shows "Got: burglary, [last month]" and "Missing: location"
  - [ ] user can refine query without retyping everything

**intent error — ambiguous query**
- [ ] query: `what happened`
  - [ ] parse returns IntentError with empty `understood` and multiple `missing` fields
  - [ ] frontend shows helpful explanation

**schema evolution**
- [ ] open Prisma Studio after running queries:
  - [ ] `SchemaVersion` table shows records with `domain: "crime"`
  - [ ] `CrimeResult` rows have `raw` column populated
  - [ ] `Query` rows have `domain: "crime"` and `resolved_location` populated
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

     POST /query/parse — interpretation only, no side effects
       └─ crime/intent.ts — parseIntent()
            DeepSeek infers: category, date_from, date_to, location
            Relative dates resolved to explicit YYYY-MM at parse time
            Zod validates LLM output against QueryPlanSchema
            IntentError thrown with understood/missing fields on failure
       └─ geocoder.ts — geocodeToPolygon()
            Nominatim resolves place name → bounding box poly + display_name
            Structured error on failure — never a plain string
       └─ crime/intent.ts — deriveVizHint()
            Viz hint derived from query shape — never from LLM
            multi-month → bar, list phrasing → table, default → map
       └─ Returns confirmation payload to frontend
            Frontend shows interpreted plan — user confirms or refines

     POST /query/execute — runs on confirmed plan
       └─ crime/fetcher.ts — fetchCrimes()
            Expands date range → sequential per-month API calls
            Police API returns crimes for each month
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
- The LLM never produces viz hints, never produces coordinates, and never produces relative dates — all three are resolved deterministically after parsing.
- Parse and execute are separate endpoints — the user always confirms what the system understood before any data pipeline runs.
- Errors carry structured context — `understood` and `missing` — so the frontend can give specific, actionable feedback rather than a generic message.
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
