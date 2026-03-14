# query-os implementation guide v2

---

## what changed from v1

- **LLM no longer generates coordinates** — it returns a place name only; Nominatim resolves it to a polygon
- **Schema evolution handles all new columns**, not just the first
- **`store.ts` writes dynamically** to whatever columns currently exist in the schema
- **`raw JSONB` column** preserves every API response regardless of schema state
- **`orchestrator2.ts` removed** — single modular architecture only
- Tests are now listed explicitly per step

---

## prerequisites

- [ ] node 20+
- [ ] docker desktop
- [ ] deepseek api key
- [ ] github repo created and cloned

---

## initial setup

```bash
bash scaffold.sh
cd query-os
git init
git remote add origin <your-repo-url>
```

```bash
git checkout -b setup/monorepo
npm install
git add .
git commit -m "chore: scaffold monorepo"
git push origin setup/monorepo
# open pull request → merge → delete branch
```

---

## test setup

```bash
git checkout main && git pull
git checkout -b setup/testing
```

```bash
npm install --save-dev vitest @vitest/coverage-v8 --workspace=apps/orchestrator
```

add to `apps/orchestrator/package.json` scripts:
```json
"test": "vitest",
"test:coverage": "vitest run --coverage"
```

create `apps/orchestrator/src/__tests__/` folder

```bash
git add .
git commit -m "chore: add vitest to orchestrator"
git push origin setup/testing
# open pull request → merge → delete branch
```

---

## step 1 — database schema

```bash
git checkout main && git pull
git checkout -b feat/database-schema
```

- [ ] open `packages/database/prisma/schema.prisma`
- [ ] define `Query` model with fields: `id`, `text`, `category`, `date`, `poly`, `viz_hint`, `createdAt`
- [ ] define `CrimeResult` model with fields:
  - `id`, `query_id`, `persistent_id`, `category`, `month`
  - `street`, `latitude`, `longitude`
  - `outcome_category`, `outcome_date`
  - `location_type`, `context`
  - `raw Json?` — stores the full API response as JSONB
- [ ] define `SchemaVersion` model with fields: `id`, `table_name`, `column_name`, `column_type`, `triggered_by`, `createdAt`
- [ ] open `packages/database/index.ts` and export `PrismaClient`

```bash
docker compose up -d
npm run db:migrate
# name the migration: initial
```

- [ ] verify tables exist

```bash
npm run db:studio
# check tables in browser at localhost:5555
# confirm CrimeResult has a `raw` column of type Json
```

```bash
git add .
git commit -m "feat: initial prisma schema with raw jsonb column"
git push origin feat/database-schema
# open pull request → merge → delete branch
```

---

## step 2 — db singleton

```bash
git checkout main && git pull
git checkout -b feat/db-singleton
```

- [ ] implement `apps/orchestrator/src/db.ts`
  - import `PrismaClient`
  - attach to `globalThis` to survive hot reloads
  - export single `prisma` instance

**tests** — `apps/orchestrator/src/__tests__/db.test.ts`
- [ ] prisma instance is defined
- [ ] same instance is returned on multiple imports (singleton check)

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: prisma singleton"
git push origin feat/db-singleton
# open pull request → merge → delete branch
```

---

## step 3 — express entry point

```bash
git checkout main && git pull
git checkout -b feat/express-server
```

- [ ] implement `apps/orchestrator/src/index.ts`
  - load `dotenv/config` — no `console.log` of key material
  - create express app
  - add `cors()` and `express.json()` middleware
  - mount `queryRouter` on `/query` (comment out until step 9)
  - `GET /health` → `{ status: "ok", timestamp: new Date().toISOString() }`
  - `app.listen(PORT)`

**tests** — `apps/orchestrator/src/__tests__/index.test.ts`
- [ ] `GET /health` returns 200
- [ ] `GET /health` returns `{ status: "ok" }` with a timestamp field
- [ ] timestamp is a valid ISO string

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: express server with health endpoint"
git push origin feat/express-server
# open pull request → merge → delete branch
```

---

## step 4 — intent parser

```bash
git checkout main && git pull
git checkout -b feat/intent-parser
```

- [ ] implement `apps/orchestrator/src/intent.ts`
  - define `QueryPlan` interface — **no `poly` field**:
    ```ts
    interface QueryPlan {
      category: CrimeCategory;
      date: string;       // YYYY-MM
      location: string;   // plain place name e.g. "Camden, London"
      viz_hint: VizHint;
    }
    ```
  - use Zod to validate LLM output — validate all four fields
  - `parseIntent(rawText)` calls LLM, strips markdown fences, parses + validates JSON
  - system prompt rules:
    - return JSON only, no prose, no fences
    - `location` must be a descriptive place name, never coordinates
    - default `location` to "Cambridge, UK" when none given
    - default `category` to `"all-crime"` when unclear
    - default `date` to most recent full month
  - throw distinct errors for missing fields vs invalid viz_hint

valid category slugs:
```
all-crime, burglary, robbery, violent-crime, anti-social-behaviour,
vehicle-crime, shoplifting, criminal-damage-arson, drugs,
possession-of-weapons, public-order, theft-from-the-person,
bicycle-theft, other-theft, other-crime
```

**tests** — `apps/orchestrator/src/__tests__/intent.test.ts`
- [ ] mock the LLM client
- [ ] returns a valid `QueryPlan` shape with all four fields
- [ ] `poly` is NOT present on the returned plan
- [ ] defaults to `"all-crime"` when no category mentioned
- [ ] extracts date in `YYYY-MM` format
- [ ] defaults to `"Cambridge, UK"` when no location given
- [ ] returns location as a place name string, never coordinates
- [ ] throws `"Missing required fields"` on incomplete LLM response
- [ ] throws `"Invalid viz_hint"` when viz_hint is not map/bar/table
- [ ] throws on malformed JSON response from LLM

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: intent parser — location name only, no coordinates"
git push origin feat/intent-parser
# open pull request → merge → delete branch
```

---

## step 5 — geocoder

```bash
git checkout main && git pull
git checkout -b feat/geocoder
```

- [ ] implement `apps/orchestrator/src/geocoder.ts`
  - `geocodeToPolygon(location: string): Promise<string>`
  - calls Nominatim (`https://nominatim.openstreetmap.org/search`)
  - params: `{ q: location, format: "json", limit: 1 }`
  - set `User-Agent` header to `"query-os/1.0"` (Nominatim requires this)
  - extracts `boundingbox` from first result: `[south, north, west, east]`
  - converts to Police API poly format: `"north,west:north,east:south,east:south,west"`
  - throws a descriptive error if no results returned
  - validate resulting polygon does not exceed 100 points before returning

```ts
// expected output format
"51.5,−0.15:51.5,−0.10:51.4,−0.10:51.4,−0.15"
```

**tests** — `apps/orchestrator/src/__tests__/geocoder.test.ts`
- [ ] mock axios
- [ ] calls Nominatim with correct `q` param
- [ ] sets `User-Agent` header
- [ ] returns a valid poly string in `lat,lng:lat,lng` format
- [ ] returned poly has exactly 4 points for a bounding box
- [ ] all coordinate values are numeric (not strings)
- [ ] throws `"Could not geocode: <location>"` when result is empty
- [ ] throws when polygon exceeds 100 points

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: nominatim geocoder"
git push origin feat/geocoder
# open pull request → merge → delete branch
```

---

## step 6 — api fetcher

```bash
git checkout main && git pull
git checkout -b feat/api-fetcher
```

- [ ] implement `apps/orchestrator/src/fetcher.ts`
  - define `RawCrime` interface (category, location, month, outcome_status, persistent_id, context, id, location_type, location_subtype)
  - `fetchCrimes(plan)` calls `https://data.police.uk/api/crimes-street/{category}`
  - accepts a `poly` string directly (resolved upstream by geocoder)
  - pass `date` and `poly` as query params
  - validate poly does not exceed 100 points before calling API
  - return `RawCrime[]`

**tests** — `apps/orchestrator/src/__tests__/fetcher.test.ts`
- [ ] mock axios
- [ ] calls correct url with category slug
- [ ] passes `date` param correctly
- [ ] passes `poly` param correctly
- [ ] returns array of `RawCrime`
- [ ] handles empty array response
- [ ] throws when polygon exceeds 100 points

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: police api fetcher"
git push origin feat/api-fetcher
# open pull request → merge → delete branch
```

---

## step 7 — schema evolution

```bash
git checkout main && git pull
git checkout -b feat/schema-evolution
```

- [ ] implement `apps/orchestrator/src/schema.ts`
  - define `SchemaOp` type: `{ op: "USE_EXISTING" }` | `{ op: "ADD_COLUMN", table, column, type }`
  - allowed Postgres types: `text`, `integer`, `bigint`, `boolean`, `double precision`, `jsonb`, `timestamptz`
  - `getCurrentColumns(prisma)` — queries `information_schema.columns` for `crime_results`
  - `findNewKeys(sampleRow, existingColumns)` — diffs keys against existing columns
  - `askLlmForSchemaOp(key, sampleValue)` — calls LLM for a single key, validates with Zod
  - `evolveSchema(prisma, sampleRow, triggeredBy)`:
    - finds all new keys
    - if none → return immediately, **no LLM call**
    - **loops over every new key** and calls `askLlmForSchemaOp` + `applySchemaOp` for each
  - `applySchemaOp(prisma, op, triggeredBy)`:
    - if `USE_EXISTING` → return
    - build `ALTER TABLE` sql
    - validate against safe regex before executing
    - run with `prisma.$executeRawUnsafe`
    - write `SchemaVersion` audit record

safe sql regex:
```
/^ALTER TABLE "?crime_results"? ADD COLUMN "?([a-z_][a-z0-9_]*)"? (text|integer|bigint|boolean|double precision|jsonb|timestamptz)$/i
```

**tests** — `apps/orchestrator/src/__tests__/schema.test.ts`
- [ ] mock LLM client and prisma
- [ ] returns `USE_EXISTING` when no new keys found
- [ ] does **not** call LLM when no new keys found
- [ ] calls LLM once **per new key** when multiple new keys present
- [ ] returns `ADD_COLUMN` op with correct shape for a single new key
- [ ] `applySchemaOp` does nothing on `USE_EXISTING`
- [ ] `applySchemaOp` runs correct ALTER TABLE sql on `ADD_COLUMN`
- [ ] `applySchemaOp` rejects unsafe sql (e.g. containing semicolons or DROP)
- [ ] `applySchemaOp` writes a `SchemaVersion` record per column added
- [ ] `evolveSchema` adds a `SchemaVersion` record for each new column

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: schema evolution — all new columns handled per request"
git push origin feat/schema-evolution
# open pull request → merge → delete branch
```

---

## step 8 — store

```bash
git checkout main && git pull
git checkout -b feat/store
```

- [ ] implement `apps/orchestrator/src/store.ts`
  - `flattenCrime(crime: RawCrime): Record<string, unknown>` — normalises nested fields into a flat object, includes `raw: crime` for full JSONB preservation
  - `storeResults(queryId, crimes, prisma)`:
    - if empty → return
    - query `information_schema.columns` to get **current** column set
    - flatten each crime with `flattenCrime`
    - for each row, filter to only keys that exist in the current schema
    - batch insert with `prisma.$transaction`

```ts
function flattenCrime(crime: RawCrime): Record<string, unknown> {
  return {
    category: crime.category,
    month: crime.month,
    street: crime.location.street.name,
    latitude: parseFloat(crime.location.latitude),
    longitude: parseFloat(crime.location.longitude),
    outcome_category: crime.outcome_status?.category ?? null,
    outcome_date: crime.outcome_status?.date ?? null,
    location_type: crime.location_type,
    context: crime.context ?? null,
    raw: crime,
    // spread any unknown top-level fields the API adds in future
    ...Object.fromEntries(
      Object.entries(crime).filter(([k]) =>
        !["category","month","location","outcome_status",
          "location_type","context","id","persistent_id","location_subtype"]
        .includes(k)
      )
    ),
  };
}
```

**tests** — `apps/orchestrator/src/__tests__/store.test.ts`
- [ ] mock prisma
- [ ] calls `prisma.$transaction` with correct number of creates
- [ ] parses `latitude` as float, not string
- [ ] parses `longitude` as float, not string
- [ ] stores full crime object in `raw` field
- [ ] only writes columns that exist in current schema (dynamic column filter)
- [ ] does not throw when a crime has extra unknown fields
- [ ] handles empty crimes array without calling `prisma.$transaction`

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: dynamic store with raw jsonb preservation"
git push origin feat/store
# open pull request → merge → delete branch
```

---

## step 9 — query pipeline

```bash
git checkout main && git pull
git checkout -b feat/query-pipeline
```

- [ ] implement `apps/orchestrator/src/query.ts`
  - create express `Router`, export as `queryRouter`
  - `POST /`:
    - [ ] validate `req.body.text` is a non-empty string, return 400 if not
    - [ ] call `parseIntent(text)` → gets `{ category, date, location, viz_hint }`
    - [ ] call `geocodeToPolygon(plan.location)` → resolves to `poly` string
    - [ ] create `Query` record in postgres (store resolved `poly`)
    - [ ] call `fetchCrimes({ ...plan, poly })`
    - [ ] if crimes returned, call `evolveSchema(prisma, sampleRow, queryRecord.id)`
    - [ ] call `storeResults(queryRecord.id, crimes, prisma)`
    - [ ] return `{ query_id, plan, poly, count, viz_hint, results }` (cap results at 100)
    - [ ] catch all errors, return 500 with message
  - `GET /:id`:
    - [ ] `prisma.query.findUnique` with `include: { results: true }`
    - [ ] return 404 if not found

- [ ] uncomment `queryRouter` import in `index.ts`

**tests** — `apps/orchestrator/src/__tests__/query.test.ts`
- [ ] mock all service imports (parseIntent, geocodeToPolygon, fetchCrimes, evolveSchema, storeResults)
- [ ] `POST /` returns 400 when `text` is missing
- [ ] `POST /` returns 400 when `text` is an empty string
- [ ] `POST /` calls `parseIntent` with trimmed text
- [ ] `POST /` calls `geocodeToPolygon` with the location name from the plan
- [ ] `POST /` calls `fetchCrimes` with the resolved poly, not the location name
- [ ] `POST /` calls `evolveSchema` when crimes are returned
- [ ] `POST /` does **not** call `evolveSchema` when crimes array is empty
- [ ] `POST /` calls `storeResults` with correct queryId and crimes
- [ ] `POST /` returns correct response shape including `poly` field
- [ ] `POST /` caps `results` at 100 items
- [ ] `POST /` returns 500 on `parseIntent` error
- [ ] `POST /` returns 500 on `geocodeToPolygon` error
- [ ] `GET /:id` returns 404 for unknown id
- [ ] `GET /:id` returns query with results included

```bash
npm test --workspace=apps/orchestrator
```

```bash
git add .
git commit -m "feat: query pipeline with geocoder integration"
git push origin feat/query-pipeline
# open pull request → merge → delete branch
```

---

## step 10 — frontend

```bash
git checkout main && git pull
git checkout -b feat/frontend
```

- [ ] implement `apps/web/src/App.tsx`
  - `useState` for `result`, `loading`, `error`
  - `handleQuery(text)` → `POST /query` → set result
  - render `<QueryInput>` and `<ResultRenderer>`
  - show error in red when set

- [ ] implement `apps/web/src/components/QueryInput.tsx`
  - controlled input
  - submit on enter or button click
  - disable while loading

- [ ] implement `apps/web/src/components/ResultRenderer.tsx`
  - summary line: count, category, date, resolved location
  - table: category | street | month | outcome
  - cap at 50 rows

```bash
git add .
git commit -m "feat: frontend query ui"
git push origin feat/frontend
# open pull request → merge → delete branch
```

---

## smoke test — full run

```bash
git checkout main && git pull
npm run dev
```

- [ ] open `http://localhost:3000`
- [ ] query: `show me burglaries in Cambridge in January 2024`
  - [ ] verify geocoder resolves "Cambridge, UK" to a bounding box (check orchestrator logs)
  - [ ] verify results table renders with street names
- [ ] query: `what were the outcomes of drug offences in Camden last month`
  - [ ] verify location "Camden, London" resolves correctly
  - [ ] verify category maps to `drugs`
- [ ] query: `show me all crime in SW1A` (postcode — tests Nominatim postcode resolution)
  - [ ] verify poly is returned and crimes load
- [ ] open `npm run db:studio`
  - [ ] verify `SchemaVersion` table shows any evolved columns
  - [ ] verify `CrimeResult` rows have `raw` column populated

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

## architecture summary

```
User text
  └─ parseIntent()       LLM extracts: category, date, location (name), viz_hint
       └─ geocodeToPolygon()   Nominatim resolves: place name → poly coordinates
            └─ fetchCrimes()        Police API: crimes within poly
                 └─ evolveSchema()       Detects new API fields, adds columns (all of them)
                      └─ storeResults()      Writes to current schema, preserves raw JSONB
```

Each module does exactly one thing it is good at. The LLM never produces coordinates.

---

## useful commands

| action | command |
|---|---|
| start db | `docker compose up -d` |
| stop db | `docker compose down` |
| run tests | `npm test --workspace=apps/orchestrator` |
| run coverage | `npm run test:coverage --workspace=apps/orchestrator` |
| run dev | `npm run dev` |
| prisma studio | `npm run db:studio` |
| new migration | `npm run db:migrate` |
| regenerate client | `npm run db:generate` |
| reset db (dev only) | `npx prisma migrate reset --workspace=packages/database` |
