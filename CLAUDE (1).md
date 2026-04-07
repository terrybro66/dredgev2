# DREDGE — Project Guide for Claude

> This file gives a new Claude session everything it needs to continue work on this project without re-reading every source file. Read this before asking for files.

---

## What DREDGE Is

DREDGE is a natural language query engine for public and commercial data. A user types a plain English question — "burglaries in Camden last month", "what's on at Odeon Braehead", "flood risk in Bristol" — and the platform finds a relevant data source, fetches the data, optionally stores it, and renders an appropriate visualisation.

The architecture is designed around one constraint: **adding a new data domain must require zero changes to existing core pipeline code.**

---

## Monorepo Structure

```
dredge/
  apps/
    orchestrator/          ← Express API server (main backend)
      src/
        __mocks__/
          prisma.ts        ← Vitest mock for all Prisma models
          setup.ts         ← Global beforeEach reset for mocks
        __tests__/         ← All test files
          crime/
            fetcher.test.ts
            store.test.ts
          database-v5.test.ts       ← Real DB tests (hits actual Postgres)
          database-hybrid.test.ts   ← Real DB tests for hybrid table (new, red)
          execution-ephemeral.test.ts ← Mock tests for storeResults bypass (new, red)
          domain-discovery.test.ts
          query.test.ts
          ... (37 test files total)
        agent/
          domain-discovery.ts       ← Discovery pipeline orchestrator
          shadow-adapter.ts         ← Recovery via alternative sources
          search/
            catalogue.ts            ← data.gov.uk catalogue search
            serp.ts                 ← SerpAPI search
          workflows/
            domain-discovery-workflow.ts  ← discoverSources, sampleSource, proposeDomainConfig
            shadow-recovery.ts
        domains/                    ← One folder per domain (no special casing)
          crime-uk/
            fetcher.ts              ← Calls police.uk API
            store.ts                ← Writes to crime_results (transitional)
            recovery.ts             ← Fallback strategies
            index.ts                ← crimeUkAdapter — implements DomainAdapter
          weather/
            index.ts                ← weatherAdapter — implements DomainAdapter
          registry.ts               ← DomainAdapter interface + registry Map
        semantic/
          classifier.ts             ← pgvector cosine similarity intent classifier
          embedding.ts
        enrichment/
          deduplication.ts
          scheduler.ts
          source-tag.ts
        providers/                  ← Transport layer (REST, CSV, XLSX, PDF)
          rest-provider.ts
          csv-provider.ts
          xlsx-provider.ts
          pdf-provider.ts
          types.ts
        availability.ts             ← Tracks which months are available per source
        db.ts                       ← PrismaClient singleton
        execution-model.ts          ← createSnapshot — QueryRun + DatasetSnapshot
        export.ts
        followups.ts
        geocoder.ts                 ← Nominatim + GeocoderCache
        index.ts                    ← Express app entry point
        intent.ts                   ← parseIntent, deriveVizHint, expandDateRange
        query.ts                    ← POST /parse and POST /execute handlers
        rateLimiter.ts
        redis.ts
        schema.ts                   ← evolveSchema (dead code — no longer called)
        workspace.ts
    web/                            ← React frontend
  packages/
    database/
      prisma/
        schema.prisma               ← Source of truth for all models
      index.ts                      ← Re-exports PrismaClient
    schemas/
      src/index.ts                  ← Zod schemas + TypeScript types shared across apps
  docker/
    Dockerfile.postgres
  docker-compose.yml
  turbo.json
```

---

## Starting the Project (Fresh Clone)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment variables
cp .env.example .env
# Fill in: DATABASE_URL, DEEPSEEK_API_KEY, OPENROUTER_API_KEY, REDIS_URL
# DATABASE_URL format: postgresql://postgres:postgres@localhost:5432/dredge

# 3. Start Docker (Postgres + Redis)
docker-compose up -d

# 4. Generate Prisma client
cd packages/database
npx prisma generate
cd ../..

# 5. Build shared packages (schemas must be built before orchestrator starts)
cd packages/schemas
npm run build
cd ../..

# 6. Run database migrations
cd packages/database
npx prisma migrate deploy
cd ../..

# 7. Start dev server
npx turbo run dev
# Orchestrator runs on http://localhost:3001
# Web frontend runs on http://localhost:5173
```

---

## Database Operations

### Run migrations

```bash
cd packages/database

# Apply all pending migrations (production-safe)
npx prisma migrate deploy

# Create a new migration after editing schema.prisma
npx prisma migrate dev --name descriptive_name_here

# Reset database completely (dev only — destroys all data)
npx prisma migrate reset
```

### View and edit the database

```bash
# Open Prisma Studio — browser-based GUI for viewing/editing all tables
cd packages/database
npx prisma studio
# Opens at http://localhost:5555

# Direct psql access
docker exec -it dredge-postgres-1 psql -U postgres -d dredge

# Useful psql queries
\dt                          -- list all tables
\d query_results             -- describe a table
SELECT * FROM domain_discovery WHERE status = 'requires_review';
SELECT * FROM data_sources WHERE enabled = true;
```

### Schema location

All schema changes go in `packages/database/prisma/schema.prisma`. After editing:

```bash
cd packages/database
npx prisma migrate dev --name your_migration_name
npx prisma generate
```

The generated client is in `node_modules/.prisma/client`. Always run `prisma generate` after `prisma migrate` so the TypeScript types stay in sync.

---

## Running Tests

```bash
# Run all tests (from repo root)
npm test --workspace=apps/orchestrator

# Run a specific test file
npm test --workspace=apps/orchestrator -- run src/__tests__/query.test.ts

# Run multiple specific files
npm test --workspace=apps/orchestrator -- run src/__tests__/query.test.ts src/__tests__/domain-discovery.test.ts

# Run in watch mode during development
npm test --workspace=apps/orchestrator -- --watch

# Run only real DB tests (requires running Postgres)
npm test --workspace=apps/orchestrator -- run src/__tests__/database-v5.test.ts src/__tests__/database-hybrid.test.ts
```

### Two types of tests

**Mock tests** (most tests) — use `prismaMock` from `@mocks/prisma`, never touch real database, fast.

**Real DB tests** (`database-v5.test.ts`, `database-hybrid.test.ts`) — use a real `PrismaClient` against the dev database. Each test cleans up after itself using `afterEach` with `deleteMany`. Requires Docker running.

### Test infrastructure

`src/__mocks__/prisma.ts` — mock for all Prisma models. Every model has `findUnique`, `findMany`, `create`, `update`, `upsert`, `delete`, `count` as `vi.fn()`. Import in tests as:
```ts
import { prismaMock } from "@mocks/prisma";
```

`src/__mocks__/setup.ts` — registered as `setupFiles` in `vitest.config.ts`. Calls `resetPrismaMocks()` in a global `beforeEach` so individual test files don't need to reset manually.

`vitest.config.ts` — key config:
```ts
resolve: { alias: { "@mocks": path.resolve(__dirname, "src/__mocks__") } }
setupFiles: ["dotenv/config", "./src/__mocks__/setup.ts"]  // dotenv loaded at config level via import
```

---

## The Query Pipeline (How Data Flows)

Every user query follows two HTTP calls:

### Step 1: POST /query/parse

**Input:** `{ text: "burglaries in Cambridge last month" }`

**Flow:**
1. `parseIntent(text)` — sends to DeepSeek LLM, returns `{ category, date_from, date_to, location }`
2. `geocodeToPolygon(location)` — Nominatim lookup, returns `{ poly, display_name, country_code }`, cached in `geocoder_cache` table
3. `classifyIntent(text)` — pgvector cosine similarity against domain embeddings, returns `{ intent, domain, confidence }`
4. If confidence ≥ 0.5: `intent` is set to the classified domain slug
5. If confidence < 0.5 or classifier fails: `intent` remains `undefined`
6. `deriveVizHint(plan, text, intent)` — deterministic rule: single month → map, multi-month → bar, "list"/"show me" → table, weather → dashboard
7. `expandDateRange(date_from, date_to)` — expands to array of `["2024-01", "2024-02", ...]`

**Output:** `{ plan, poly, viz_hint, resolved_location, country_code, intent, months }`

The frontend shows this to the user for confirmation before executing.

### Step 2: POST /query/execute

**Input:** The full parse output plus the original body.

**Flow:**
1. `getDomainForQuery(country_code, intent)` — looks up registered adapter in the domain registry Map
2. If no adapter found: triggers `domainDiscovery.run()` if enabled, returns `400 unsupported_region`
3. Compute deterministic `query_hash` from domain + category + dates + location
4. Check `queryCache` — if hit and within TTL, return cached results immediately
5. `acquire(adapter.config)` — Redis-backed token bucket rate limiter
6. `adapter.fetchData(plan, poly)` — calls the domain-specific fetch implementation
7. If empty: `adapter.recoverFromEmpty()` — tries date fallback, radius reduction, category broadening
8. If still empty: `shadowAdapter.recover()` — finds alternative sources via discovery workflow
9. `adapter.storeResults(queryId, rows, prisma)` — writes to `query_results`
10. `createSnapshot()` — seals `QueryRun` + `DatasetSnapshot` with SHA-256 checksum
11. Query stored results from DB, apply viz transforms (aggregate for map, group for bar, slice for table)
12. Write `QueryCache` entry
13. Return results with `resultContext` (exact / fallback / empty)

**Key invariant:** `query.ts` never contains domain-specific logic. It calls adapter hooks only.

### The Discovery Pipeline (when no adapter matches)

Triggered when `getDomainForQuery` returns `undefined`:

1. `discoverSources(intent, country_code)`:
   - Try `searchCatalogue()` — data.gov.uk API, instant, confidence 0.8
   - Try `searchWithSerp()` — SerpAPI, confidence 0.5
   - Fall back to `discoverWithBrowser()` — StagehandCrawler + Bing search
2. `sampleSource(url)` — fetch 5 rows, parse JSON/CSV/XLSX
3. `proposeDomainConfig(intent, country_code, source, rows)` — LLM proposes:
   - Domain name (kebab-case)
   - Field map (`source_field → standard_field` or `source_field → extras.key`)
   - Confidence score
   - `storeResults` (persistent vs ephemeral)
   - `refreshPolicy` (realtime/daily/weekly/static)
   - `ephemeralRationale`
4. Save `DomainDiscovery` record with `status: "requires_review"`
5. Return `null` — **never auto-registers**. Human approval required via admin endpoint.

---

## How Domains Work Now

### The DomainAdapter interface

Every domain implements this interface in `src/domains/registry.ts`:

```ts
interface DomainAdapter {
  config: DomainConfig;           // name, tableName, prismaModel, countries, intents, etc.
  fetchData(plan, poly): Promise<unknown[]>;
  flattenRow(row): Record<string, unknown>;
  storeResults(queryId, rows, prisma): Promise<void>;
  recoverFromEmpty?(plan, poly, prisma): Promise<{ data, fallback } | null>;
  onLoad?(): void | Promise<void>;  // called at startup after registration
}
```

### Current domains

**crime-uk** (`src/domains/crime-uk/index.ts`):
- Countries: `["GB"]`, Intents: `["crime"]`
- Fetches from `https://data.police.uk/api/crimes-street/{category}`
- Stores to `query_results` table via `queryResult.createMany`
- `onLoad` calls `loadAvailability("police-uk", ...)` to cache available months
- Recovery: date fallback → smaller radius → all-crime broadening

**weather** (`src/domains/weather/index.ts`):
- Countries: `[]` (global), Intents: `["weather"]`
- Fetches from Open-Meteo API (archive or forecast depending on date)
- Stores to `query_results` table via `queryResult.createMany`
- Recovery: future date → falls back to today

### Domain registry

`src/domains/registry.ts` holds a `Map<string, DomainAdapter>`. At startup:
```ts
async function loadDomains() {
  for (const adapter of [crimeUkAdapter, weatherAdapter]) {
    registerDomain(adapter);
    if (adapter.onLoad) await adapter.onLoad();
  }
}
```

`getDomainForQuery(countryCode, intent)` iterates the Map, matches on both `intents` array and `countries` array (empty countries = global).

---

## How Adding a New Domain Will Work (Post-Migration)

Once the hybrid `query_results` table and registration step are built, adding a domain will work like this:

### Option A — Manual (code a known stable source)

1. Create `src/domains/your-domain/index.ts` implementing `DomainAdapter`
2. Set `config.storeResults = true/false` as appropriate
3. Set `config.defaultOrderBy` (typically `{ date: "asc" }`)
4. Set `config.temporality` to `"time-series"` (date-bound queries) or `"static"` (timeless queries like cinema, car-hire)
5. Add to `loadDomains()` in `registry.ts`
6. No migration needed — all results go to `query_results`

### Option B — Via discovery pipeline (automatic)

1. User submits query with unknown intent
2. Discovery pipeline runs, creates `DomainDiscovery` record with `status: "requires_review"`
3. Admin calls `POST /admin/discovery/:id/approve` (optionally with overrides)
4. Registration step creates `DataSource` record
5. If `storeResults: false`: registers ephemeral fetch-and-discard adapter
6. If `storeResults: true`: registers full `GenericAdapter` writing to `query_results`
7. Future identical queries take the fast path (cache → adapter → return)

### DomainConfig fields relevant to hybrid table

```ts
{
  name: "cinema-listings-gb",
  storeResults: false,               // controls pipeline bypass
  defaultOrderBy: { date: "asc" },   // object form required by Zod schema
  refreshPolicy: "realtime",         // scheduler uses this
  temporality: "static",             // "static" → effectiveMonths = [] (no date constraint passed to adapter)
  intents: ["cinema listings"],
  countries: ["GB"],
  // all adapters write to query_results / queryResult
}
```

---

## Current TDD Cycle

### The rule

**Tests first. Code to pass. Stop and run before proceeding.**

Never write implementation before tests exist for it. Never move to the next block until the current block is green.

### Branch convention

```
feat/hybrid-table                  ← merged to main
feat/export-fix                    ← merged to main
feat/store-to-query-results        ← merged to main
feat/query-history-carousel        ← merged to main
feat/static-domain-temporality     ← merged to main
feat/shadow-adapter-fix            ← next
```

### Current state

All tests green. The following major work has landed on main since the last CLAUDE.md update:

- **Unified storage**: crime-uk and weather adapters both write to `query_results` via `queryResult.createMany`
- **Domain-agnostic export**: `GET /export/:id` reads only from `query_results` (GeoJSON + CSV)
- **`evolveSchema` removed**: no longer called in `query.ts`; the function still exists in `schema.ts` but is dead code
- **Static domain temporality**: `DomainConfig.temporality` field added; `"static"` domains receive `effectiveMonths: []` so date constraints are not passed to the adapter
- **Query history carousel**: `GET /query/history` endpoint + `QueryHistoryCarousel` React component

**Active branch:** `main` (all recent features merged)

**Key files added/changed since last CLAUDE.md update:**
- `src/query.ts` — `resolvedIntent` + `CATEGORY_TO_INTENT` map, `GET /query/history` route, `intent` stored on Query records, `evolveSchema` removed, `effectiveMonths` gated on `temporality`
- `src/export.ts` — reads only `queryResult.findMany`, domain-agnostic GeoJSON + CSV
- `src/domains/crime-uk/store.ts` — writes to `queryResult.createMany` (not `crime_results`)
- `src/domains/weather/index.ts` — writes to `queryResult.createMany` (not `weather_results`), `temporality: "time-series"`, `defaultOrderBy: { date: "asc" }`
- `src/domains/crime-uk/index.ts` — `temporality: "time-series" as const`
- `packages/schemas/src/index.ts` — `temporality: z.enum(["time-series", "static"]).optional()` added to `DomainConfigSchema`
- `src/intent.ts` — system prompt updated with UK place name disambiguation rule
- `src/agent/search/catalogue.ts` — dead-link filter (datapress.com URLs skipped)
- `apps/web/src/store.ts` — Zustand store with `executeQuery` action
- `apps/web/src/components/QueryHistoryCarousel.tsx` — TanStack Query + Zustand, no prop drilling
- `apps/web/src/main.tsx` — wrapped in `QueryClientProvider`
- `apps/web/src/components/ResultRenderer.tsx` — domain-agnostic renderers, ephemeral badge
- `apps/web/src/App.tsx` — generic renderers, header, empty state, `setExecuteQuery` on mount

**Deleted files:**
- `src/domains/weather.ts` (duplicate; canonical copy is `domains/weather/index.ts`)
- `src/domains/crime-uk.ts` (old top-level adapter)
- `src/crime/` (entire directory — fetcher, store, recovery, index)

### Full baseline check (run before committing)

```bash
npm test --workspace=apps/orchestrator -- run \
  src/__tests__/query.test.ts \
  src/__tests__/index.test.ts \
  src/__tests__/availability.test.ts \
  src/__tests__/startup.test.ts \
  src/__tests__/semantic-classifier.test.ts \
  src/__tests__/execution-model.test.ts \
  src/__tests__/crime-uk-intent.test.ts \
  src/__tests__/domain-discovery.test.ts
```

These 8 files are the baseline — all 101+ tests must remain green throughout.

### Commit and push pattern

```bash
# After tests pass
git add -A
git commit -m "feat: hybrid query_results table + ephemeral pipeline bypass"
git push origin feat/hybrid-table

# Then open PR or merge to main
# Then start next branch
git checkout main && git pull
git checkout -b feat/next-thing
```

---

## Key Architectural Constraints

These must not be violated:

1. **`query.ts` is domain-agnostic** — no domain names, no domain-specific field names, no crime/weather logic
2. **`raw` is never lost** — every result row stores the full original payload in `raw` JSONB
3. **Discovery never auto-registers** — `domainDiscovery.run()` always returns `null`; registration requires human approval
4. **Ephemeral enforcement before ephemeral sources** — the `storeResults: false` bypass must be proven before any ephemeral sources are added to the curated registry
5. **LLM output is always a proposal** — all LLM responses pass Zod schema validation before use
6. **Failures in non-critical paths never propagate** — classifier, shadow adapter, discovery failures return `undefined`/`null`, never throw to the user
7. **Workspace snapshots are immutable** — `createSnapshot` only appends, never mutates

---

## Current Status and Known Issues

### Browser Testing Findings (March 2026)

End-to-end browser testing exposed a class of data shape problems not covered by unit tests. The system has no contract between what a source returns and what a domain expects.

#### Active bugs

| Bug | Severity | Status |
|---|---|---|
| Shadow adapter accepts irrelevant sources (Plymouth 2003 CSV for Bury St Edmunds crime query) | High | Open — fix planned (see below) |
| Shadow adapter writes to `crime_results` via crime-uk `storeResults`, fails on missing `category` field | High | Open — fix planned |
| `evolveSchema` adds columns for garbage rows before shape validation | Medium | Open — fix planned |
| Ambiguous UK place names geocode incorrectly ("Bury" → "Bury St Edmunds" not "Bury, Gtr Manchester") | Medium | Partially fixed — system prompt updated, old queries still cached |
| `src/schema.ts` contains dead `evolveSchema` function | Low | Open — safe to delete if confirmed no imports |

#### Fixed this session

| Fix | Description |
|---|---|
| `ADD COLUMN IF NOT EXISTS` | `evolveSchema` no longer crashes on duplicate column names |
| `resolvedIntent` fallback | Crime subcategories ("burglary") now route to crime-uk adapter correctly |
| `CATEGORY_TO_INTENT` map | All crime category slugs map to the "crime" intent slug |
| Discovery intent | Raw query text no longer passed to discovery pipeline |
| `GET /query/history` | History endpoint added, returns `poly`, `country_code`, `intent` |
| `intent` on Query record | Stored at execute time for correct carousel re-runs |
| Carousel crash fix | `poly` and `country_code` now taken from history entry, not hardcoded |
| UK geocoder prompt | System prompt instructs LLM to include county for ambiguous place names |

---

### Planned Fixes — Shadow Adapter Data Shape (next branch: `feat/shadow-adapter-fix`)

The shadow adapter has no contract between what a source returns and what the domain expects. Five fixes needed in dependency order:

**Fix 1 — Shape validation before accepting a source** (`shadow-adapter.ts`)

After sampling rows, validate they contain the minimum fields the domain needs. For crime: at least one of `category`/`type` and one of `month`/`date`. Reject sources that don't meet this — return `null` so the pipeline continues to "no results" rather than storing garbage.

```ts
function isValidCrimeShape(rows: unknown[]): boolean {
  if (rows.length === 0) return false;
  const first = rows[0] as Record<string, unknown>;
  const hasCategory = "category" in first || "type" in first || "offence" in first;
  const hasDate = "month" in first || "date" in first;
  return hasCategory && hasDate;
}
```

**Fix 2 — Shadow adapter writes to `query_results`, not domain table** (`shadow-adapter.ts`)

Shadow-recovered rows should write to the hybrid `query_results` table, not `crime_results`. Crime-uk `storeResults` requires exact crime API field names. Shadow data should use the generic `queryResult.createMany` path instead.

**Fix 3 — Apply fieldMap at fetch time** (`generic-adapter.ts`, `shadow-adapter.ts`)

The LLM proposes a `fieldMap` in `proposeDomainConfig` but it's stored and never applied. Both the generic adapter and shadow adapter need to transform source field names to canonical names using the fieldMap before calling `storeResults`.

**Fix 4 — Geography relevance check** (`shadow-adapter.ts`)

Reject sources whose URL or description doesn't contain something related to the query location. A Plymouth dataset for a Bury St Edmunds query should be filtered out. Simple heuristic: check if the query location's county or region appears in the source URL or description.

**Fix 5 — ~~Move `evolveSchema` after shape validation~~** — Moot

`evolveSchema` has been removed from `query.ts` entirely. All adapters now write to the fixed `query_results` schema, so no dynamic ALTER TABLE logic runs. The function still exists in `schema.ts` as dead code.

---

## Environment Variables

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dredge
DEEPSEEK_API_KEY=...          # Intent parsing (parseIntent)
OPENROUTER_API_KEY=...        # Domain config proposal (proposeDomainConfig) + Stagehand
REDIS_URL=redis://localhost:6379
DOMAIN_DISCOVERY_ENABLED=true # Set to enable discovery pipeline
OPENWEATHER_API_KEY=...       # Required for weather adapter to run
AVAILABILITY_CACHE_TTL_SECONDS=3600
```

---

## Roadmap Summary

| Item | Status |
|---|---|
| 1.1 Remove crime-as-default intent | ✅ Done |
| 1.2 Move intent utils out of crime/ | ✅ Done |
| 1.3 Eliminate src/crime/ directory | ✅ Done |
| 1.4 loadAvailability → onLoad hook | ✅ Done |
| 2.1 Hybrid storage model decision | ✅ Decided |
| 2.2 Hybrid model governance rules | ✅ Documented |
| 3.0 proposeDomainConfig ephemeral fields | ✅ Done |
| 3.1 Hybrid query_results migration | ✅ Done |
| 3.2 DataSource model | ✅ Done |
| 3.3 Admin approval endpoint | ✅ Done |
| 3.4 Registration — ephemeral path | ✅ Done |
| 3.5 Ephemeral pipeline enforcement | ✅ Done |
| 3.6 Registration — persistent path | ✅ Done |
| 3.7 Curated source registry | ✅ Done |
| 3.8 ScrapeProvider | ✅ Done |
| 3.9 Source scoring | ✅ Done |
| 3.10 Auto-approval threshold | ✅ Done |
| 3.11 Source-level URL routing | ✅ Done |
| 3.12 Frontend ephemeral label | ✅ Done |
| 4.1 Query history carousel | ✅ Done |
| 4.1a Unified query_results storage (crime-uk + weather) | ✅ Done |
| 4.1b Domain-agnostic export endpoint | ✅ Done |
| 4.1c Remove evolveSchema from pipeline | ✅ Done |
| 4.1d Static domain temporality (`temporality` flag) | ✅ Done |
| 4.2 Shadow adapter shape validation | ⬜ Next |
| 4.3 Shadow adapter → query_results | ⬜ Blocked on 4.2 |
| 4.4 FieldMap applied at fetch time | ⬜ Blocked on 4.3 |
| 4.5 Geography relevance filter | ⬜ Blocked on 4.2 |
| 4.6 evolveSchema after validation | ⬜ Moot — evolveSchema removed from pipeline |

Full detail on each item is in `guides/DREDGE_ROADMAP.md`.
