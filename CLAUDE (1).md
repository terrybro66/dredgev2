# DREDGE — Project Guide for Claude

> Read this before asking for files. Covers architecture, pipeline, domains, and current state.

---

## What DREDGE Is

A natural language query engine for public data. Users type plain English ("burglaries in Camden", "flood risk in Bristol") and the platform routes to the right domain adapter, fetches data, and renders map/chart/table. **Core constraint: adding a new domain requires zero changes to pipeline code.**

---

## Monorepo Structure

```
apps/
  orchestrator/               ← Express API (port 3001)
    src/
      __mocks__/              ← prismaMock + global beforeEach reset
      __tests__/              ← ~75 test files (vitest)
      agent/
        domain-discovery.ts   ← agentic source discovery
        shadow-adapter.ts     ← fallback recovery
        search/catalogue.ts   ← data.gov.uk search
        search/serp.ts        ← SerpAPI search
        workflows/
          domain-discovery-workflow.ts  ← discoverSources, sampleSource, proposeDomainConfig
          shadow-recovery.ts
      domains/
        crime-uk/             ← police.uk API, time-series, GB only
        weather/              ← Open-Meteo, global
        cinemas-gb/           ← Overpass API, persistent Track A
        hunting-zones-gb/     ← NE ArcGIS CRoW open access land, GB
        food-business-gb/     ← regulatory adapter (eligibility only)
        hunting-licence-gb/   ← regulatory adapter
        geocoder/             ← wraps geocodeToCoordinates, ephemeral
        travel-estimator/     ← haversine + speed table, ephemeral
        registry.ts           ← DomainAdapter interface + Map
      semantic/
        classifier.ts         ← pgvector cosine similarity routing
        embedding.ts
        pattern-store.ts      ← recordSuccessfulPattern (E.2, not yet wired)
      types/
        connected.ts          ← Chip, ResultHandle, WorkflowTemplate etc.
      providers/              ← rest, csv, xlsx, pdf, scrape
      enrichment/             ← deduplication, scheduler, source-tag, source-scoring
      availability.ts         ← tracks available months per source
      capability-inference.ts ← inferCapabilities, generateChips, DOMAIN_CHIPS
      clarification.ts        ← buildClarificationRequest
      co-occurrence-log.ts
      conversation-memory.ts  ← ResultHandle store, session result_stack
      curated-registry.ts
      db.ts                   ← PrismaClient singleton
      execution-model.ts      ← createSnapshot
      export.ts
      followups.ts
      geocoder.ts             ← Nominatim + GeocoderCache
      index.ts                ← Express entry, loadDomains, police availability load
      intent.ts               ← parseIntent, deriveVizHint, expandDateRange
      itinerary-assembler.ts  ← pure fn, hunting day schedule (E.3)
      query-router.ts         ← 3-tier router (template / refinement / similarity)
      query.ts                ← POST /parse and POST /execute
      rateLimiter.ts
      redis.ts
      regulatory-adapter.ts   ← RegulatoryAdapter registry
      session.ts              ← getUserLocation / setUserLocation (Redis, 24h TTL)
      suggest-followups.ts
      workflow-executor.ts    ← executeWorkflow, step I/O mapping
      workflow-templates.ts   ← WORKFLOW_TEMPLATES (4 templates)
  web/                        ← React frontend (port 5173), App.tsx is monolithic
packages/
  database/prisma/schema.prisma  ← source of truth for all DB models
  schemas/src/index.ts           ← Zod schemas shared across apps
```

---

## Quick Start

```bash
npm install
cp .env.example .env   # fill DATABASE_URL, DEEPSEEK_API_KEY, OPENROUTER_API_KEY, REDIS_URL
docker-compose up -d
cd packages/database && npx prisma generate && npx prisma migrate deploy && cd ../..
cd packages/schemas && npm run build && cd ../..
npx turbo run dev
```

---

## Database Operations

```bash
# Migrations
cd packages/database
npx prisma migrate deploy          # apply pending (production-safe)
npx prisma migrate dev --name foo  # create new migration after schema edit
npx prisma generate                # regenerate client after migrate

# Inspect
npx prisma studio                  # browser GUI at http://localhost:5555
docker exec -it dredge-postgres-1 psql -U postgres -d dredge
```

All schema changes go in `packages/database/prisma/schema.prisma`. Always run `prisma generate` after `prisma migrate`.

---

## Running Tests

```bash
cd apps/orchestrator && npx vitest run              # all tests
npx vitest run src/__tests__/query.test.ts          # single file
npx vitest run src/__tests__/e3-adapters.test.ts    # E.3 specific
```

**Mock tests** use `prismaMock` from `@mocks/prisma` — never touch the real DB, fast.
**Real DB tests** (`database-v5.test.ts`) require Docker running.

Test infrastructure:
- `src/__mocks__/prisma.ts` — all Prisma models as `vi.fn()`. Import as `import { prismaMock } from "@mocks/prisma"`
- `src/__mocks__/setup.ts` — global `beforeEach` reset, registered in `vitest.config.ts` `setupFiles`
- `vi.hoisted()` — required when `vi.mock` factory references variables (avoids TDZ errors)
- `beforeEach(() => mockFn.mockClear())` — required when mock call counts accumulate across tests

---

## The Query Pipeline

### POST /query/parse

1. Detect `"where am I"` pattern → return `{ type: "location_info", location }` ← **not yet implemented**
2. `parseIntent(text)` → `{ category, date_from, date_to, location }` via DeepSeek
3. Substitute "near me" from `getUserLocation(sessionId)` if present
4. `geocodeToPolygon(location)` → `{ poly, display_name, country_code }`, cached in `geocoder_cache`
5. `setUserLocation(sessionId, ...)` — store for future near-me queries
6. `classifyIntent(text, prisma)` → pgvector similarity; if confidence ≥ 0.5 set `intent`
7. `findWorkflowsForIntent(text)` → if match, attach `suggested_workflow` to response
8. Return `{ plan, poly, viz_hint, resolved_location, country_code, intent, months, suggested_workflow? }`

**D.15 intercept:** if `suggested_workflow` present, frontend shows `WorkflowInputForm` instead of calling `/execute`.

### POST /query/execute

1. **Clarification check** — `buildClarificationRequest(text)` returns questions if regulatory intent and no `user_attributes` yet
2. **Regulatory adapter** — if `getRegulatoryAdapter(text)` matches and `user_attributes` present → return `DecisionResult`
3. **Intent routing** — `CATEGORY_TO_INTENT` normalises LLM variants (`"cinema listings"→"cinemas"`, `"crime statistics"→"crime"`) → `getDomainForQuery(country_code, routingIntent)`
4. If no adapter → check curated registry → build on-the-fly adapter or trigger `domainDiscovery.run()`
5. Hash check → rate limiter → `adapter.fetchData(plan, poly)`
6. If empty → `adapter.recoverFromEmpty()` → `shadowAdapter.recover()`
7. `adapter.storeResults()` → `createSnapshot()`
8. `suggestFollowups()` → `generateChips()` → chip ranking → return with `suggested_chips`
9. `recordDomainCoOccurrence(sessionId, domain)` — fire-and-forget

### POST /query/workflow

`executeWorkflow(workflowId, input, prisma)` — runs steps sequentially, maps I/O between steps, returns `WorkflowResult`.

### Discovery pipeline (when no adapter matches)

1. `discoverSources(intent, country_code)` — tries catalogue → SerpAPI → headless browser
2. `sampleSource(url)` — fetch 5 rows, parse JSON/CSV/XLSX
3. `proposeDomainConfig(...)` — LLM proposes name, fieldMap, storeResults, refreshPolicy
4. Save `DomainDiscovery` with `status: "requires_review"` — **never auto-registers**
5. Human approves via `POST /admin/discovery/:id/approve`

---

## Domains

| Domain | Intent(s) | Source | Viz | Notes |
|---|---|---|---|---|
| `crime-uk` | `"crime"` | police.uk API | map / bar | recovery: date shift, smaller radius, all-crime |
| `weather` | `"weather"` | Open-Meteo | table | global |
| `cinemas-gb` | `"cinemas"` | Overpass API | map | persistent Track A; showtimes via Track B chip |
| `hunting-zones-gb` | `"hunting zones"` | NE ArcGIS CRoW | map | ⚠ lat/lon swap bug — on fix list |
| `food-business-gb` | regulatory | — | decision | RegulatoryAdapter, no data fetch |
| `hunting-licence-gb` | regulatory | — | decision | leads to zones chip on eligible result |
| `geocoder` | workflow step | Nominatim | — | ephemeral, `storeResults: false` |
| `travel-estimator` | workflow step | haversine | — | ephemeral, `storeResults: false` |

**Curated registry** (`curated-registry.ts`): cinema listings (scrape, Track B), flood risk, transport, others.

### DomainAdapter interface

```ts
interface DomainAdapter {
  config: DomainConfig;           // name, countries, intents, storeResults, temporality, etc.
  fetchData(plan, poly): Promise<unknown[]>;
  flattenRow(row): Record<string, unknown>;
  storeResults(queryId, rows, prisma): Promise<void>;
  recoverFromEmpty?(plan, poly, prisma): Promise<{ data, fallback } | null>;
  onLoad?(): void | Promise<void>;
}
```

### Adding a new domain

**Option A — manual:** create `src/domains/your-domain/index.ts` implementing `DomainAdapter`, add to `loadDomains()` in `registry.ts`. Set `temporality: "time-series"` (date-bound) or `"static"` (timeless). No migration needed — all results go to `query_results`.

**Option B — via discovery:** user submits unknown query → pipeline creates `DomainDiscovery` record → admin approves → adapter auto-registered. `storeResults: false` = ephemeral; `storeResults: true` = persistent `GenericAdapter`.

---

## Workflow Templates

| id | Steps |
|---|---|
| `reachable-area` | geocode-origin → compute-isochrone |
| `itinerary` | geocode-origin → discover-pois → optimise-route → compute-travel-times |
| `cross-domain-overlay` | fetch-layer-a → fetch-layer-b → spatial-join |
| `hunting-day-plan` | geocode-origin → fetch-zones → compute-travel-times |

`hunting-day-plan` result → `assembleHuntingItinerary()` → `Itinerary` with timed stops. Frontend renders via `WorkflowResultPanel`.

---

## Connected Queries / Chips

`capability-inference.ts`:
- `inferCapabilities(rows)` — detects `has_coordinates`, `has_time_series`, `has_polygon`, `has_schedule`, `has_category`
- `generateChips(handle)` — maps capabilities to chips; `DOMAIN_CHIPS` adds domain-specific overrides (`"cinemas-gb"` → "What's on here?", `"hunting-zones-gb"` → "Plan a day here")

Chip actions in `App.tsx`: `show_map`, `show_chart`, `filter_by`, `calculate_travel`, `cinema-showtimes`, `hunting-day-plan`.

---

## Semantic Routing (E.2)

`QueryRouter` (`query-router.ts`) has three tiers:
1. **Template match** — `findWorkflowsForIntent(query)`
2. **Refinement** — `REFINEMENT_PATTERNS` regex
3. **pgvector similarity** — `classifyIntent(query, prisma)`, threshold 0.65

`classifyIntent` also called in `/parse` at threshold 0.5. Embeddings seeded on startup via `registerDomainEmbeddings` (requires `DEEPSEEK_API_KEY`).

`recordSuccessfulPattern` in `pattern-store.ts` — exists but **not yet wired** to call sites (fix list item 4).

---

## Current Fix List

| # | Fix | Status |
|---|---|---|
| 1 | `"where am I"` → location info response | Pending |
| 2 | Hunting zones ArcGIS lat/lon swap in `polyToBbox` | Pending |
| 3 | Leeds/SE1 crime still routing to domain discovery | Pending |
| 4 | Wire `recordSuccessfulPattern` call sites — E.4.1 | Pending |
| 5 | Workflow result handle — store itinerary in session result_stack — E.4.2 | Pending |
| 6 | Workflow refinement chips — E.4.3 | Pending |

Applied this session: police availability load on startup, `"cinema listings"→"cinemas"` in `CATEGORY_TO_INTENT`.

---

## Key Architectural Rules

1. `query.ts` is domain-agnostic — no domain names or domain-specific fields
2. `raw` is never lost — full payload stored in JSONB
3. Discovery never auto-registers — human approval required via `/admin/discovery/:id/approve`
4. Non-critical path failures never propagate — classifier, shadow adapter, co-occurrence are fire-and-forget
5. LLM output always passes Zod validation before use
6. `createSnapshot` only appends, never mutates

---

## Environment Variables

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dredge
DEEPSEEK_API_KEY=...         # intent parsing + embeddings
OPENROUTER_API_KEY=...       # domain discovery + Stagehand
REDIS_URL=redis://localhost:6379
DOMAIN_DISCOVERY_ENABLED=true
SERPAPI_KEY=...              # URL resolution for scrape pipeline
AVAILABILITY_CACHE_TTL_SECONDS=3600
```

---

## Branch State

**`main`** is current and contains all Phase D + E work. Phase E.4 (learning loop closure) is next.
