# DREDGE — Project Guide

> Read this before asking for files. Covers architecture, pipeline, domains, current state, and known gaps.

---

## What DREDGE Is

A natural-language query engine for public data. Users type plain English ("burglaries in Camden", "flood risk in Bristol") and the platform routes to the right domain adapter, fetches data, and renders map/chart/table. **Core vision: a flexible learning tool that auto-discovers and approves new domains, evolves schemas to accommodate new data shapes, and chains cross-domain results via connected queries — all without pipeline code changes.**

The north star is six user stories that each end in a useful insight after a succession of connected queries:
1. **House move** — crime in LS6 → flood risk → food hygiene → insight: safe streets identified
2. **Friday night** — cinemas in Manchester → weather this weekend → food hygiene nearby → pick venue + day
3. **Planning objection** — planning applications → crime correlation → flood risk → multi-ground objection
4. **Pub landlord** — crime spike over 6 months → weather during period → nearby venues → spike attributed to new operators
5. **School run** — crime in BS7 vs BS6 → food hygiene → comparison insight → school choice
6. **Food entrepreneur** — cinemas (footfall proxy) → food hygiene density → crime → site shortlist

Every architectural decision should be tested against: does this help a user reach one of those insights?

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
        registration.ts       <- registerDiscoveredDomain (uses createPipelineAdapter)
        auto-approval.ts      <- shouldAutoApprove (gov.uk + REST + confidence >= 0.9)
        shadow-adapter.ts     <- DEAD — never enabled, to be deleted
        search/catalogue.ts   <- data.gov.uk search
        search/serp.ts        <- SerpAPI search (key expired — D11)
        workflows/
          domain-discovery-workflow.ts  <- discoverSources, sampleSource, proposeDomainConfig
          shadow-recovery.ts            <- DEAD — tied to shadow-adapter
      domains/
        crime-uk/             <- police.uk API, time-series, GB only — writes to query_results
        weather/              <- Open-Meteo, global — writes to query_results
        cinemas-gb/           <- Overpass API, places template
        hunting-zones-gb/     <- DEAD — endpoint dead (D8), removed from registry, dir to delete
        food-hygiene-gb/      <- FSA Ratings API, listings template
        food-business-gb/     <- regulatory adapter (eligibility only)
        hunting-licence-gb/   <- regulatory adapter (not registered on startup)
        geocoder/             <- wraps geocodeToCoordinates, ephemeral, pipeline primitive
        travel-estimator/     <- haversine + speed table, ephemeral, pipeline primitive
        generic-adapter.ts    <- createPipelineAdapter (primary) + createGenericAdapter (legacy, loadDomains only)
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
      followups.ts            <- DEAD — removed from query.ts call sites, file to delete
      geocoder.ts             <- Nominatim + GeocoderCache
      index.ts                <- Express entry, loadDomains, police availability load
      insight.ts              <- generateInsight (one-sentence summary)
      intent.ts               <- parseIntent, deriveVizHint, expandDateRange
      itinerary-assembler.ts  <- hunting day schedule (legacy, hunting domain dead)
      query-router.ts         <- 3-tier router (template / refinement / similarity)
      query.ts                <- POST /parse, /execute, /chip, /workflow, /history, /:id
      rateLimiter.ts
      redis.ts
      regulatory-adapter.ts   <- RegulatoryAdapter registry
      relationship-discovery.ts <- getMergedRelationships (seeded + learned from Redis)
      schema.ts               <- evolveSchema (EXISTS but NEVER CALLED — see Known Gaps)
      session.ts              <- getUserLocation / setUserLocation (Redis, 24h TTL)
      suggest-followups.ts    <- domain-agnostic: infer -> generate -> rank -> top 3
      temporal-resolver.ts    <- defaultResolveTemporalRange + resolveTemporalRangeForCrime
      workflow-executor.ts    <- executeWorkflow, step I/O mapping
      workflow-templates.ts   <- WORKFLOW_TEMPLATES (4 templates, seed data only — to be deleted Phase 0.6)
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

**Pending migration:** `drop_crime_weather_legacy_tables` — removes `crime_results` and `weather_results` tables. Run before starting the server after the April 2026 storage migration.

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
- Any test mocking `prisma.crimeResult` or `prisma.weatherResult` — those models are gone, update to `prisma.queryResult`

---

## The Query Pipeline

### POST /query/parse

1. `parseIntent(text)` via DeepSeek → `{ category, temporal, location }`
2. Substitute "near me" from `getUserLocation(sessionId)` if present
3. `geocodeToPolygon(location)` → `{ poly, display_name, country_code }`, cached
4. `setUserLocation(sessionId, ...)` for future near-me queries
5. `classifyIntent(text, prisma)` → pgvector similarity; if confidence >= 0.5 set `intent`
6. Resolve temporal expression: look up adapter via classified intent, call `adapter.resolveTemporalRange(temporal)` if present, else `defaultResolveTemporalRange(temporal)` — **no domain names in this logic**
7. `findWorkflowsForIntent(text)` → attach `suggested_workflow` if match
8. Return `{ plan, poly, viz_hint, resolved_location, country_code, intent, months, suggested_workflow? }`

### POST /query/execute

1. **Clarification check** — `buildClarificationRequest(text)` for regulatory intents
2. **Regulatory adapter** — if `getRegulatoryAdapter(text)` matches + `user_attributes`
3. **Intent routing** — `CATEGORY_TO_INTENT` normalises LLM output → `getDomainForQuery(country_code, routingIntent)`
4. If no adapter → curated registry → on-the-fly adapter or `domainDiscovery.run()`
5. Hash check → rate limiter → `adapter.fetchData(plan, poly)`
6. If empty → `adapter.recoverFromEmpty()`
7. `adapter.storeResults()` → `createSnapshot()`
8. `getVizHint(adapter.config, months)` — adapter config is authoritative
9. `suggestFollowups()` → `generateChips()` → `rankChips()` → top 3 chips
10. `recordDomainCoOccurrence(sessionId, domain)` — fire-and-forget
11. `generateInsight()` — one-sentence summary above results

**Removed from pipeline:** shadow adapter recovery, `generateFollowUps` (legacy hand-coded follow-ups), crime-specific temporal resolution branch, `CRIME_DATA_START` constant.

### POST /query/chip

Handles chip clicks. Implemented handlers:
- `fetch_domain` + `cinema-showtimes` — SerpAPI showtime lookup
- `calculate_travel` — returns workflow input form for reachable-area
- `fetch_domain` + `hunting-day-plan` — returns workflow input form (hunting domain dead, but handler remains)
- **`fetch_domain` + any registered domain** — generic handler (W.1): reads session `active_plan`/`active_poly` (W.2), calls `adapter.fetchData(plan, poly)`, returns rows + viz_hint

All other actions return 400 `unsupported_chip_action`.

### POST /query/workflow

`executeWorkflow(workflowId, input, prisma)` — runs steps sequentially, maps I/O.

### Discovery pipeline (when no adapter matches)

1. `discoverSources(intent, country_code)` — catalogue → SerpAPI (key expired, D11) → browser (Stagehand, broken D11)
2. `sampleSource(url)` — fetch 5 rows, parse JSON/CSV/XLSX
3. `proposeDomainConfig(...)` — LLM proposes name, fieldMap, storeResults, refreshPolicy — **does not yet propose templateShape** (gap)
4. Auto-approval check: confidence >= 0.9 AND REST AND gov.uk domain
5. If auto-approved: `registerDiscoveredDomain()` → adapter immediately live
6. Otherwise: save as `requires_review` → Telegram notification → admin approves via POST

---

## Storage Architecture

**Single system — all domains write to `query_results`.**

| Table | Used by | Fields |
|-------|---------|--------|
| `query_results` | all domains | date, lat, lon, location, description, category, value, raw, extras (JSONB), domain_name |

The `crime_results` and `weather_results` tables have been removed from the schema. The migration `drop_crime_weather_legacy_tables` must be run. Crime and weather adapters now write to `query_results`:
- Crime: `date` = `new Date(month + "-01")`, `lat`/`lon` from string fields, `extras` = `{ persistent_id, outcome_category, outcome_date }`
- Weather: `lat`/`lon` (renamed from `latitude`/`longitude`), `value` = `temperature_max`, `extras` = `{ temperature_min, precipitation, wind_speed }`

The `extras` JSONB column is the overflow / promotion staging ground. `evolveSchema()` exists in `schema.ts` but is never called — schema evolution is a planned phase.

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
- Domain-specific: "What's on here?" (cinemas)
- Suppressed globally: overlay_spatial, clarify (no backend handlers)
- Suppressed per-domain: calculate_travel suppressed for crime-uk
- **Cross-domain chips: NOT YET GENERATED** — template affinity engine is the next build item

**Chip ranking** (`chip-ranker.ts`):
- Score = frequency(0.4) + spatialRelevance(0.3) + recency(0.2) + relationship(0.1)
- Returns top CHIP_DISPLAY_MAX (3) chips
- Relationship weights from `domain-relationships.ts` (seeded) + Redis co-occurrence (learned)

**Generic chip handler (W.1 + W.2):** Implemented. Any `fetch_domain` chip pointing to a registered domain calls the adapter with session context (plan + poly) carried forward from the parent result.

---

## Domains

| Domain | Intent(s) | Source | Template | Viz | Status |
|--------|-----------|--------|----------|-----|--------|
| `crime-uk` | `"crime"` | police.uk API | incidents | map / bar | Working — writes to query_results |
| `weather` | `"weather"` | Open-Meteo | forecasts | dashboard | Working — writes to query_results |
| `cinemas-gb` | `"cinemas"` | Overpass API | places | map | Working |
| `food-hygiene-gb` | `"food hygiene"` | FSA Ratings API | listings | table | Working, no lat/lon (D16) |
| `food-business-gb` | regulatory | — | regulations | decision | Working |
| `hunting-licence-gb` | regulatory | — | regulations | decision | Not registered on startup |
| `geocoder` | workflow step | Nominatim | — | — | Ephemeral, pipeline primitive |
| `travel-estimator` | workflow step | haversine | — | — | Ephemeral, pipeline primitive |

**Removed:** `hunting-zones-gb` — NE ArcGIS CRoW endpoint is dead (D8). Import and directory to be deleted.

**Needed but not yet built:**
- `flood-risk-gb` — EA flood warnings API, template: boundaries. Critical for Stories 1, 3, 4.
- Planning applications — via auto-discovery once D11 is fixed. Template: incidents/listings.

**Dynamic domains** — `loadDomains()` reloads from `domainDiscovery` records with status `"registered"`. Survives restarts. These use `createPipelineAdapter` (persistent) or inline ephemeral adapter (storeResults: false).

### DomainAdapter interface

```ts
interface DomainAdapter {
  config: DomainConfigV2;
  fetchData(plan, poly): Promise<unknown[]>;
  flattenRow(row): Record<string, unknown>;
  storeResults(queryId, rows, prisma): Promise<void>;
  recoverFromEmpty?(plan, poly, prisma): Promise<{ data, fallback } | null>;
  normalizePlan?(plan): any;
  resolveTemporalRange?(temporal): Promise<{ date_from, date_to }>;
  onLoad?(): void | Promise<void>;
}
```

### DomainConfigV2 shape templates

Six templates cover the data classes public APIs return. Every domain must have one — it drives capability inference, chip generation, and cross-domain affinity:

| Template | Canonical fields | Capabilities | Example domains |
|----------|-----------------|--------------|-----------------|
| `incidents` | date, lat, lon, category, description | has_coordinates, has_time_series, has_category | crime, accidents, planning apps |
| `places` | lat, lon, name, description, category | has_coordinates, has_category | cinemas, GP surgeries, parks |
| `forecasts` | date, value, unit, description | has_time_series | weather, air quality, tidal |
| `boundaries` | GeoJSON geometry, name, properties | has_polygon | flood zones, conservation areas |
| `listings` | name, price, category, location, date | has_coordinates, has_category | food hygiene, businesses |
| `regulations` | applies_to, condition, outcome | has_regulatory_reference | licences, eligibility rules |

---

## Organic Cross-Domain Connection (planned — not yet built)

Cross-domain chips must emerge from data structure, not hardcoded relationship tables. Three layers:

**Layer 1 — Template affinity matrix** (next build item, `capability-inference.ts`)

After generating capability chips, scan all registered domains for compatible templates and emit `fetch_domain` chips:

```
incidents  →  boundaries  (spatial overlap)
incidents  →  places      (proximity)
incidents  →  forecasts   (temporal — carry date range)
places     →  listings    (entity correlation)
places     →  forecasts   (conditions at location)
listings   →  incidents   (area context)
boundaries →  incidents   (what's inside)
boundaries →  places      (services within zone)
```

Only emit if target domain is registered. Only emit if target domain has spatial coverage overlapping the current query polygon (Layer 2).

**Layer 2 — Spatial coverage filter**

After `storeResults`, derive bounding box from lat/lon distribution and cache in Redis keyed by domain name. Chip generation queries this — suppresses chips for domains with no data in the current area. Bootstraps empty on first fetch (chip emitted, may return empty, recoverFromEmpty fires).

**Layer 3 — Co-occurrence learning** (already exists)

`co-occurrence-log.ts` and `relationship-discovery.ts` already record and merge domain pair weights from user sessions. Layer 1 breaks the cold-start (no chips → no clicks → no signal). Once chips appear and users click, co-occurrence accumulates and chip ranking improves automatically.

---

## Auto-Approval and Discovery

**Current state:**
- Auto-approval works for gov.uk + REST + confidence ≥ 0.9 → `registerDiscoveredDomain()` called immediately → domain live
- Manual approval is broken: `domainDiscovery.approve()` flips status but never calls `registerDiscoveredDomain()` — manually approved domains never become live adapters
- Discovery pipeline fails at source finding (SERP key expired D11, Stagehand extraction returns null D11)
- Discovered domains always get `template: { type: "listings" }` regardless of actual data shape — they don't participate in template affinity

**What needs fixing (Phase 5 of user story plan):**
1. Guard discovery when curated registry already matched — skip `domainDiscovery.run()` entirely
2. Fix Stagehand extraction prompt: return `[]` not null-filled objects when no data found
3. Renew SERP API key (operational)
4. `proposeDomainConfig` must include `templateShape` selection — one extra prompt instruction, one extra field in proposed config
5. Fix manual approval loop: after status flip, call `registerDiscoveredDomain()`

**Discovery response UX (planned):**
When no domain matches, return `discovering` state (not `error: "not_supported"`) with a `discovery_id`. Frontend shows transient "searching for a source" card. When auto-approval fires, emit event keyed by `discovery_id` so frontend can re-execute automatically.

---

## Location Handling

**Do not ask for location.** Resolve silently in this priority order:

1. **Session memory** — `getUserLocation(sessionId)` from any prior query in the session. Already implemented.
2. **Browser Geolocation API** — frontend requests permission once on first load, sends coordinates with first query. Not yet wired.
3. **IP geolocation** — coarse, city-level. Fallback for cold sessions with no permission. Not yet wired.
4. **Query context** — LLM extracts location from natural language ("Is Headingley safe?" → Leeds). Already implemented via `parseIntent`.

Asking the user is only acceptable if all four fail and the domain requires a precise location. In that case: a single inline text prompt in the result area, not a modal, not a form field.

**Connected queries carry location automatically** via `active_poly` and `active_plan` in session context. Chip handler reads this — never asks.

---

## Viz Module Pattern (planned — not yet built)

Frontend views should be generic modules, not domain-specific components. Target architecture:

```
packages/viz-specs/          <- shared type definitions (VizSpec discriminated union)
packages/viz-map/            <- MapSpec + MapRenderer
packages/viz-dashboard/      <- DashboardSpec + DashboardRenderer
packages/viz-table/          <- TableSpec + TableRenderer (TableView is already generic)
packages/viz-bar/            <- BarSpec + BarRenderer
packages/viz-video/          <- VideoSpec + VideoRenderer (planned, see video-guide-module.md)
```

The spec builder (in orchestrator) translates `DomainConfigV2 + QueryResult[]` → `VizSpec`. Frontend router switches on `spec.vizType`, no intent checks, no domain names. A new domain with `template: "forecasts"` automatically gets a working dashboard without frontend changes.

**Current state:** `MapView` typed as `CrimeResult[]`, `DashboardView` hardcodes weather field names (`temperature_max`, `temperature_min` etc.), `BarChart` typed as `CrimeResult[]`. These need updating as part of Phase 3 (frontend result stack). Note: weather fields `temperature_min`, `precipitation`, `wind_speed` are now in `extras` JSONB — `DashboardView` must read from `extras`.

---

## Semantic Routing

`QueryRouter` (`query-router.ts`) has three tiers:
1. **Template match** — `findWorkflowsForIntent(query)`
2. **Refinement** — `REFINEMENT_PATTERNS` regex with domain-match guard (C.1 — implemented)
3. **pgvector similarity** — `classifyIntent(query, prisma)`, threshold 0.65

---

## Known Gaps

### RESOLVED in April 2026 session
- ~~No generic chip handler~~ — W.1 implemented. Generic `fetch_domain` handler routes to any registered adapter.
- ~~Conversation memory doesn't feed connected queries~~ — W.2 implemented. Chip handler reads `active_plan`/`active_poly` from session.
- ~~Two storage systems~~ — crime and weather now write to `query_results`. `crime_results` and `weather_results` tables dropped from schema (migration pending).
- ~~Two follow-up systems~~ — `followups.ts` removed from `query.ts` call sites. `suggestFollowups` is the only follow-up system. `followups.ts` file still exists — delete it.
- ~~Shadow adapter called in production~~ — all shadow adapter references removed from `query.ts`. File still exists — delete it.
- ~~Crime-specific logic in query.ts~~ — `CRIME_DATA_START`, crime temporal branch, `resolveTemporalRangeForCrime` import all removed. Temporal resolution routes through `adapter.resolveTemporalRange` generically.

### OPEN

**1. Manual approval loop broken**
`domainDiscovery.approve()` sets status to "approved" but never calls `registerDiscoveredDomain()`. Manually approved domains never become live adapters. Fix: call `registerDiscoveredDomain` after status flip.

**2. Schema evolution disconnected**
`evolveSchema()` in `schema.ts` is fully implemented but never called. New fields from discovered domains land in `extras` JSONB but are never promoted to real columns. Planned Phase 3.

**3. Template affinity not implemented**
Cross-domain chips are not generated. `generateChips` in `capability-inference.ts` only generates capability-based and domain-specific chips. The template affinity matrix (incidents→boundaries, places→forecasts etc.) is designed but not built. This is the highest priority next item.

**4. Frontend views domain-hardcoded**
- `DashboardView` hardcodes weather field names — weather fields now in `extras`, this is broken
- `MapView` typed as `CrimeResult[]` — works structurally (lat/lon present) but type is wrong
- `BarChart` typed as `CrimeResult[]`
- Frontend does not render chip results as a stacked result view — chip responses disappear

**5. proposeDomainConfig does not select templateShape**
Auto-approved domains always get `template: { type: "listings" }`. They don't participate in template affinity. Discovery workflow needs to include template shape selection in the LLM prompt.

**6. Food hygiene uses city name not coordinates** (D16)
FSA fetcher queries by `plan.location` string. When called from a chip carrying a cinema or crime polygon, the city name fallback is wrong. Switch to lat/lon from poly centroid — FSA API supports `?lat=X&lng=Y&pageSize=100`.

**7. Discovery pipeline broken** (D11)
SERP key expired (401). Stagehand extraction returns `{"url":"null","description":"null"}` — missing `format` field, Zod rejects it. Discovery triggers even when curated registry already matched. Three separate fixes needed.

**8. Flood risk domain missing**
EA flood warnings API is in the curated registry but not a full registered domain adapter. Needed for Stories 1, 3, 4 and as the canonical `boundaries` template example.

**9. Files to delete**
These files are dead and should be removed:
- `apps/orchestrator/src/followups.ts`
- `apps/orchestrator/src/agent/shadow-adapter.ts`
- `apps/orchestrator/src/agent/workflows/shadow-recovery.ts`
- `apps/orchestrator/src/domains/hunting-zones-gb/` (entire directory)
- `apps/orchestrator/src/itinerary-assembler.ts` (hunting domain dead)

---

## Key Architectural Rules

1. `query.ts` is domain-agnostic — no domain names, no domain-specific fields, no intent === "x" checks
2. `raw` is never lost — full payload stored in JSONB
3. Non-critical path failures never propagate — classifier, co-occurrence are fire-and-forget with structured logging
4. LLM output always passes Zod validation before use
5. `createSnapshot` only appends, never mutates
6. Every domain is a config row — no domain is a special case in pipeline code
7. Cross-domain connections emerge from template structure — never hardcode domain→domain relationships

---

## Current Build Plan (User Story Plan)

Phases to make all six user stories work:

| Phase | What | Unblocks |
|---|---|---|
| 1 | Template affinity engine in `capability-inference.ts` + spatial coverage filter | Cross-domain chips appear organically for all registered domains |
| 2 | `flood-risk-gb` domain adapter (boundaries template) | Stories 1, 3, 4 |
| 3 | Frontend: result stack rendering + generic chip result view | All stories (chip results visible) |
| 4 | Food hygiene lat/lon fix (D16) | Stories 2, 6 |
| 5 | Fix D11 (discovery prereqs) + templateShape in proposeDomainConfig | Story 3 (planning applications via auto-approval) |
| 6 | Cross-result spatial overlap + comparison insight card | Stories 1, 4, 5 |
| 7 | Natural language synthesis across result stack | Story 6 (entrepreneur insight) |

Phases 1, 2, 3 are independent and can proceed in parallel. Phase 6 needs Phases 1 + 3. Phase 7 needs Phase 6.

---

## Environment Variables

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dredge
DEEPSEEK_API_KEY=...         # intent parsing + embeddings
OPENROUTER_API_KEY=...       # domain discovery + Stagehand
REDIS_URL=redis://localhost:6379
DOMAIN_DISCOVERY_ENABLED=true
SERPAPI_KEY=...              # URL resolution for scrape pipeline (key expired — renew)
AVAILABILITY_CACHE_TTL_SECONDS=3600
```

---

## Branch State

Work through April 2026 is on `main`. The April 2026 session completed:
- Storage migration: crime and weather → query_results (Prisma migration pending: `drop_crime_weather_legacy_tables`)
- query.ts: domain-agnostic (shadow adapter, followups, crime-specific logic all removed)
- registry.ts: hunting zones removed
- registration.ts: uses createPipelineAdapter
- schema.prisma: CrimeResult and WeatherResult models removed

Next priority: Phase 1 (template affinity engine) — start in `capability-inference.ts`.
