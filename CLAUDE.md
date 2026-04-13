# DREDGE — Project Guide

> Read this before asking for files. Covers architecture, pipeline, domains, current state, and known gaps.

---

## What DREDGE Is

A natural-language query engine for public data. Users type plain English ("burglaries in Camden", "flood risk in Bristol") and the platform routes to the right domain adapter, fetches data, and renders map/chart/table. **Core vision: a flexible learning tool that auto-discovers and approves new domains, evolves schemas to accommodate new data shapes, and chains cross-domain results via connected queries — all without pipeline code changes.**

---

## Monorepo Structure

```
apps/
  orchestrator/               <- Express API (port 3001)
    src/
      __mocks__/              <- prismaMock + global beforeEach reset
      __tests__/              <- ~75 test files (vitest)
      agent/
        domain-discovery.ts   <- agentic source discovery
        registration.ts       <- registerDiscoveredDomain (auto-approved -> live)
        auto-approval.ts      <- shouldAutoApprove (gov.uk + REST + confidence >= 0.9)
        shadow-adapter.ts     <- fallback recovery (dormant, needs env flag)
        search/catalogue.ts   <- data.gov.uk search
        search/serp.ts        <- SerpAPI search
        workflows/
          domain-discovery-workflow.ts  <- discoverSources, sampleSource, proposeDomainConfig
          shadow-recovery.ts
      domains/
        crime-uk/             <- police.uk API, time-series, GB only
        weather/              <- Open-Meteo, global
        cinemas-gb/           <- Overpass API, persistent Track A
        hunting-zones-gb/     <- NE ArcGIS CRoW open access land, GB (endpoint dead — D8)
        food-hygiene-gb/      <- FSA Ratings API
        food-business-gb/     <- regulatory adapter (eligibility only)
        hunting-licence-gb/   <- regulatory adapter (not registered on startup — unreachable)
        geocoder/             <- wraps geocodeToCoordinates, ephemeral
        travel-estimator/     <- haversine + speed table, ephemeral
        generic-adapter.ts    <- createGenericAdapter for discovered domains
        registry.ts           <- DomainAdapter interface + Map, loadDomains
      semantic/
        classifier.ts         <- pgvector cosine similarity routing
        embedding.ts
        pattern-store.ts      <- recordSuccessfulPattern (not yet wired)
      types/
        connected.ts          <- Chip, ResultHandle, WorkflowTemplate, CHIP_DISPLAY_MAX
      providers/              <- rest, csv, xlsx, pdf, scrape
      enrichment/             <- deduplication, scheduler, source-tag, source-scoring
      availability.ts         <- tracks available months per source (Redis-backed)
      capability-inference.ts <- inferCapabilities, generateChips, suppression lists
      chip-ranker.ts          <- rankChips (frequency + spatial + recency + relationship)
      clarification.ts        <- buildClarificationRequest
      co-occurrence-log.ts    <- Redis sorted set for domain-pair co-occurrence
      conversation-memory.ts  <- ResultHandle store, session result_stack (Redis)
      curated-registry.ts
      db.ts                   <- PrismaClient singleton
      domain-relationships.ts <- static seed weights for cross-domain chip ranking
      domain-slug.ts          <- CATEGORY_TO_INTENT normalisation
      execution-model.ts      <- createSnapshot
      export.ts
      followups.ts            <- hand-coded per-domain follow-up chips (legacy)
      geocoder.ts             <- Nominatim + GeocoderCache
      index.ts                <- Express entry, loadDomains, police availability load
      insight.ts              <- generateInsight (one-sentence summary)
      intent.ts               <- parseIntent, deriveVizHint, expandDateRange
      itinerary-assembler.ts  <- hunting day schedule (E.3)
      query-router.ts         <- 3-tier router (template / refinement / similarity)
      query.ts                <- POST /parse, /execute, /chip, /workflow, /history, /:id
      rateLimiter.ts
      redis.ts
      regulatory-adapter.ts   <- RegulatoryAdapter registry
      relationship-discovery.ts <- getMergedRelationships (seeded + learned from Redis)
      schema.ts               <- evolveSchema (EXISTS but NEVER CALLED — see Known Gaps)
      session.ts              <- getUserLocation / setUserLocation (Redis, 24h TTL)
      suggest-followups.ts    <- domain-agnostic: infer -> generate -> rank -> top 3
      workflow-executor.ts    <- executeWorkflow, step I/O mapping
      workflow-templates.ts   <- WORKFLOW_TEMPLATES (4 templates, seed data only)
  web/                        <- React frontend (port 5173)
    src/
      App.tsx                 <- monolithic: all views, chip handling, result rendering
      api.ts                  <- shared API URL constant
      components/
        WorkspacesPanel.tsx
        QueryHistoryCarousel.tsx
packages/
  database/prisma/schema.prisma  <- source of truth for all DB models
  schemas/src/index.ts           <- Zod schemas shared across apps
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
cd packages/database
npx prisma migrate deploy          # apply pending (production-safe)
npx prisma migrate dev --name foo  # create new migration after schema edit
npx prisma generate                # regenerate client after migrate
npx prisma studio                  # browser GUI at http://localhost:5555
```

All schema changes go in `packages/database/prisma/schema.prisma`. Always run `prisma generate` after `prisma migrate`.

---

## Running Tests

```bash
cd apps/orchestrator && npx vitest run              # all tests
npx vitest run src/__tests__/query.test.ts          # single file
```

**Mock tests** use `prismaMock` from `@mocks/prisma` — never touch the real DB, fast.
**Real DB tests** (`database-v5.test.ts`) require Docker running.

Test infrastructure:
- `src/__mocks__/prisma.ts` — all Prisma models as `vi.fn()`
- `src/__mocks__/setup.ts` — global `beforeEach` reset, registered in `vitest.config.ts`
- `vi.hoisted()` — required when `vi.mock` factory references variables (avoids TDZ errors)

**Known pre-existing failures:**
- `domain-discovery.test.ts` — needs `OPENAI_API_KEY` env var
- Web component tests — need React/jest-dom globals not configured in runner

---

## The Query Pipeline

### POST /query/parse

1. `parseIntent(text)` via DeepSeek -> `{ category, date_from, date_to, location }`
2. Substitute "near me" from `getUserLocation(sessionId)` if present
3. `geocodeToPolygon(location)` -> `{ poly, display_name, country_code }`, cached
4. `setUserLocation(sessionId, ...)` for future near-me queries
5. `classifyIntent(text, prisma)` -> pgvector similarity; if confidence >= 0.5 set `intent`
6. `findWorkflowsForIntent(text)` -> attach `suggested_workflow` if match
7. Return `{ plan, poly, viz_hint, resolved_location, country_code, intent, months, suggested_workflow? }`

### POST /query/execute

1. **Clarification check** — `buildClarificationRequest(text)` for regulatory intents
2. **Regulatory adapter** — if `getRegulatoryAdapter(text)` matches + `user_attributes`
3. **Intent routing** — `CATEGORY_TO_INTENT` normalises LLM output -> `getDomainForQuery(country_code, routingIntent)`
4. If no adapter -> curated registry -> on-the-fly adapter or `domainDiscovery.run()`
5. Hash check -> rate limiter -> `adapter.fetchData(plan, poly)`
6. If empty -> `adapter.recoverFromEmpty()` -> `shadowAdapter.recover()`
7. `adapter.storeResults()` -> `createSnapshot()`
8. vizHintRules override from adapter config if present
9. `suggestFollowups()` -> `generateChips()` -> `rankChips()` -> top 3 chips
10. `recordDomainCoOccurrence(sessionId, domain)` — fire-and-forget
11. `generateInsight()` — one-sentence summary above results

### POST /query/chip

Handles chip clicks. **Only 3 actions implemented:**
- `fetch_domain` + `cinema-showtimes` — SerpAPI showtime lookup
- `calculate_travel` — returns workflow input form for reachable-area
- `fetch_domain` + `hunting-day-plan` — returns workflow input form

**All other chip actions return 400 `unsupported_chip_action`.**

### POST /query/workflow

`executeWorkflow(workflowId, input, prisma)` — runs steps sequentially, maps I/O.

### Discovery pipeline (when no adapter matches)

1. `discoverSources(intent, country_code)` — catalogue -> SerpAPI -> browser
2. `sampleSource(url)` — fetch 5 rows, parse JSON/CSV/XLSX
3. `proposeDomainConfig(...)` — LLM proposes name, fieldMap, storeResults, refreshPolicy
4. Auto-approval check: confidence >= 0.9 AND REST AND gov.uk domain
5. If auto-approved: `registerDiscoveredDomain()` -> adapter immediately live
6. Otherwise: save as `requires_review` -> Telegram notification -> admin approves via POST

---

## Storage Architecture

**Two parallel systems exist (known tech debt):**

| System | Table | Used by | Fields |
|--------|-------|---------|--------|
| Domain-specific | `crime_results` | crime-uk only | category, month, street, latitude, longitude, outcome_* |
| Domain-specific | `weather_results` | weather only | date, temperature_max/min, precipitation, wind_speed |
| Generic | `query_results` | all other domains | date, lat, lon, location, description, category, value, raw, extras (JSONB) |

The generic `query_results` table stores overflow in the `extras` JSONB column. The domain-specific tables pre-date the generic system and remain because crime-uk and weather adapters write to them directly.

---

## Chip System (Connected Queries)

The chip system is the mechanism for cross-domain and within-domain follow-up actions.

**Capability inference** (`capability-inference.ts`):
- `has_coordinates` (>= 80% of rows have lat+lon)
- `has_time_series` (>= 2 dates + numeric field)
- `has_polygon`, `has_schedule`, `has_category`
- `has_regulatory_reference`, `has_training_requirement` — set by adapters, not inferred

**Chip generation** (`generateChips`):
- Capability-based: show_map, show_table, show_chart, calculate_travel, filter_by
- Domain-specific: "What's on here?" (cinemas), "Plan a day here" (hunting)
- Suppressed globally: overlay_spatial, clarify (no backend handlers)
- Suppressed per-domain: calculate_travel suppressed for crime-uk

**Chip ranking** (`chip-ranker.ts`):
- Score = frequency(0.4) + spatialRelevance(0.3) + recency(0.2) + relationship(0.1)
- Returns top CHIP_DISPLAY_MAX (3) chips
- Relationship weights from seeded + learned (Redis co-occurrence) data

**Two parallel follow-up systems (known tech debt):**
- `followups.ts` — hand-coded per domain (crime, weather, hunting, flood). Returns `FollowUp[]` with pre-built query plans.
- `suggest-followups.ts` — domain-agnostic: infer capabilities -> generate chips -> rank. Returns `Chip[]`.
- Both are called in /execute. The hand-coded system covers drill-down (6 months, all-crime, widen), the generic system covers cross-domain suggestions.

---

## Domains

| Domain | Intent(s) | Source | Viz | Status |
|--------|-----------|--------|-----|--------|
| `crime-uk` | `"crime"` | police.uk API | map / bar | Working, most polished |
| `weather` | `"weather"` | Open-Meteo | table | Working, global |
| `cinemas-gb` | `"cinemas"` | Overpass API | map | Working, showtimes partially wired |
| `hunting-zones-gb` | `"hunting zones"` | NE ArcGIS CRoW | map | Endpoint dead (D8) |
| `food-hygiene-gb` | `"food hygiene"` | FSA Ratings API | table | Working, no map view |
| `food-business-gb` | regulatory | - | decision | Working |
| `hunting-licence-gb` | regulatory | - | decision | Not registered on startup |
| `geocoder` | workflow step | Nominatim | - | Ephemeral |
| `travel-estimator` | workflow step | haversine | - | Ephemeral |

**Dynamic domains** — `loadDomains()` reloads from DomainDiscovery records with status "registered". Survives restarts.

### DomainAdapter interface

```ts
interface DomainAdapter {
  config: DomainConfig;
  fetchData(plan, poly): Promise<unknown[]>;
  flattenRow(row): Record<string, unknown>;
  storeResults(queryId, rows, prisma): Promise<void>;
  recoverFromEmpty?(plan, poly, prisma): Promise<{ data, fallback } | null>;
  normalizePlan?(plan): any;
  resolveTemporalRange?(temporal): Promise<{ date_from, date_to }>;
  onLoad?(): void | Promise<void>;
}
```

---

## Semantic Routing

`QueryRouter` (`query-router.ts`) has three tiers:
1. **Template match** — `findWorkflowsForIntent(query)`
2. **Refinement** — `REFINEMENT_PATTERNS` regex (currently disabled — see Known Gaps)
3. **pgvector similarity** — `classifyIntent(query, prisma)`, threshold 0.65

---

## Known Gaps and Splintering

These are the key architectural issues identified in the April 2026 audit. See `.claude/audit.md` for the full factual record and `.claude/roadmap-v3.md` for the phased fix plan.

### 1. Approval loop is broken
`domainDiscovery.approve()` flips status to "approved" but does NOT call `registerDiscoveredDomain()`. Auto-approved domains work (status goes straight to "registered"). Manually approved domains never become live adapters. **The approve method must call registerDiscoveredDomain after changing status.**

### 2. Schema evolution is disconnected
`evolveSchema()` in `schema.ts` is fully implemented (diffs row keys vs table columns, issues ALTER TABLE ADD COLUMN, validates SQL safety, records in SchemaVersion). But it is **never called** from `query.ts` or any adapter's `storeResults`. Schema cannot evolve at runtime.

### 3. No generic chip handler
`/query/chip` has 3 hand-coded handlers (cinema-showtimes, calculate_travel, hunting-day-plan). Every other chip action returns 400. There is no generic `fetch_domain` handler that could route to any registered adapter. Cross-domain chips generated by capability inference are dead buttons.

### 4. Frontend views are domain-hardcoded
- `TableView` is truly generic (reads Object.keys dynamically)
- `MapView` types as `CrimeResult[]`
- `DashboardView` hardcodes weather fields
- `BarChart` typed as `CrimeResult[]`
- Intent checks like `intent === "weather"` gate rendering logic

### 5. Two storage systems
`CrimeResult` and `WeatherResult` tables exist alongside the generic `QueryResult`. No migration path defined.

### 6. Two follow-up systems
Hand-coded `followups.ts` (per-domain drill-down) and generic `suggest-followups.ts` (capability-inferred chips) run in parallel with no coordination.

### 7. Conversation memory doesn't feed connected queries
`conversation-memory.ts` stores a `result_stack` in Redis per session. Chips carry `args.ref` pointing to a handle ID. But chip handlers don't read the result stack to carry context (location, date range) from one query to the next.

---

## Key Architectural Rules

1. `query.ts` is domain-agnostic — no domain names or domain-specific fields
2. `raw` is never lost — full payload stored in JSONB
3. Non-critical path failures never propagate — classifier, shadow adapter, co-occurrence are fire-and-forget
4. LLM output always passes Zod validation before use
5. `createSnapshot` only appends, never mutates

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

**`main`** contains all work through Phase D + crime polish (Phases A-D of roadmap-v2 complete). Active work is on `claude/interesting-grothendieck` worktree branch. See `.claude/roadmap-v3.md` for the current plan.
