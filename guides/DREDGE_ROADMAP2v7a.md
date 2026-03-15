# DREDGE — Development Roadmap

> Last updated: March 2026 · Current version: v6.0

---

## Current State (v6.0)

DREDGE is a multi-source data intelligence platform. It accepts natural language queries, routes them to domain-specific adapters, fetches and stores results, and renders visualisations appropriate to the data type. The current architecture supports:

- UK crime data via the Police API (REST)
- Weather data via Open-Meteo (REST)
- Spatial aggregation with PostGIS
- TTL-aware query caching
- Per-adapter rate limiting
- Parallel month fetching
- CSV and GeoJSON export
- LLM intent parsing via DeepSeek
- Domain registry with country and intent routing
- d3 weather dashboard, MapLibre crime maps, bar charts, tables

---

## v6.1 — Stabilisation

**Goal:** Address the in-memory state limitations in v6.0 before introducing new data sources or agentic features. Required before horizontal scaling is possible.

### What it does

- Moves the rate limiter token buckets from in-memory state to Redis — multiple orchestrator instances now share a single rate limit pool rather than each maintaining their own
- Moves the availability cache (`availability.ts`) to Redis with a configurable TTL — availability data survives restarts and is consistent across instances
- Adds a Redis health check to the startup sequence — if Redis is unavailable the orchestrator logs a warning and falls back to in-memory mode rather than refusing to start
- Documents the `REDIS_URL` environment variable in `.env.example`

### Why this matters

Both the rate limiter and availability cache reset on server restart and are not shared across processes. Running two orchestrator instances behind a load balancer today would result in each instance having its own independent rate limit counter, allowing up to 2× the configured requests per minute to reach external APIs. Redis eliminates this class of bug before it becomes a production incident.

### Tech stack

| Concern | Library |
|---|---|
| Redis client | `ioredis` |
| Rate limiter backend | Redis sorted sets or `rate-limiter-flexible` |
| Availability cache backend | Redis `SET` with TTL |

### Key files

```
apps/orchestrator/src/
  redis.ts                    ← shared ioredis client, health check
  rateLimiter.ts              ← updated to use Redis backend
  availability.ts             ← updated to use Redis backend
```

---

## Phase 7 — Provider Layer & Generic Adapter

**Goal:** Decouple transport logic from domain logic so that new data sources requiring CSV, XLSX, PDF, or web scraping can be added without writing bespoke adapter code for each.

### What it does

- Formalises the `Provider` interface introduced informally with `RestProvider` in v6.0
- Implements three new providers: `CsvProvider`, `XlsxProvider`, `PdfProvider`
- Introduces a `GenericAdapter` that reads a `sources` array from `DomainConfig` and fans out to the appropriate provider per source
- Extends `DomainConfig` with a `sources` array supporting multiple transport types per domain
- A domain with multiple sources (e.g. REST API + CSV download) merges all rows into a single result set before storing — the query pipeline and frontend are unaffected
- Adds a `refreshPolicy` field per source (`realtime | daily | weekly | static`) so the cache TTL can be set per source rather than per domain

### Tech stack

| Concern | Library |
|---|---|
| CSV parsing | `papaparse` |
| XLSX parsing | `xlsx` (SheetJS) |
| PDF text extraction | `pdf-parse` |
| HTTP transport | `axios` (existing) |
| Schema validation | `zod` (existing) |

### Key files

```
apps/orchestrator/src/providers/
  csv-provider.ts
  xlsx-provider.ts
  pdf-provider.ts
  types.ts                    ← Provider interface
apps/orchestrator/src/domains/
  generic-adapter.ts          ← createGenericAdapter(config)
packages/schemas/src/index.ts ← DomainConfig sources array extension
```

---

## Phase 7b — Shadow Adapter Pattern

**Goal:** Give every existing adapter an automatic fallback layer that fires when a primary source fails or returns empty — without deleting or replacing the fast REST path. Discovered alternative sources are remembered in `ApiAvailability` so subsequent identical queries are served from the enriched source directly.

### What it does

The shadow adapter sits between `query.ts` and the primary adapter. The existing execution path is preserved exactly:

```
Primary path (always tried first — fast):
  REST adapter → known API → result

Shadow path (fires only on empty result or fetch failure):
  Mastra workflow
    → Stagehand: find alternative source for this intent + location + date
    → Provider: fetch sample, detect format (REST / CSV / XLSX / scrape)
    → LLM: map extracted rows to existing domain schema via flattenRow
    → Store rows under same query_id — result returned to user
    → Write discovered source URL to ApiAvailability with providerType + confidence

Warm path (next identical query):
  ApiAvailability lookup finds shadow-discovered source
  Primary REST adapter + shadow source queried in parallel via Promise.all
  Results merged, deduplicated, stored as normal
```

This means the user gets data on the first miss (via the shadow agent), and on every subsequent query the shadow source is promoted to a co-primary with no agent overhead.

### Integration point in `query.ts`

The shadow layer requires only a small change to the existing recovery hook:

```ts
// After primary fetch returns empty or throws:
if (rows.length === 0 && shadowAdapter.isEnabled()) {
  const shadow = await shadowAdapter.recover(adapter.config, plan, poly, prisma);
  if (shadow) {
    rows = shadow.data;
    fallback = shadow.fallback;
    // shadow.newSource written to ApiAvailability automatically
  }
}
```

No other changes to `query.ts`, the registry, or any existing adapter.

### `ApiAvailability` schema extension

```prisma
model ApiAvailability {
  id               String   @id @default(cuid())
  source           String   @unique
  months           String[]
  fetchedAt        DateTime @default(now())
  // New fields:
  sourceUrl        String?
  providerType     String?   // rest | csv | xlsx | scraper
  confidence       Float?    // 0.0–1.0 set by LLM analysis step
  shadowDiscovered Boolean   @default(false)
  lastUsedAt       DateTime?
  @@map("api_availability")
}
```

### Mastra workflow — shadow recovery

```
ShadowRecoveryWorkflow
  step 1: SearchAlternativeSources
    input:  intent, location, country_code, date_range
    tool:   Stagehand — web search + navigation
    output: candidate[] { url, formatHint, confidence }

  step 2: SampleAndDetect
    input:  candidates[]
    tool:   Provider autodetect (RestProvider | CsvProvider | XlsxProvider)
    output: sample rows per candidate

  step 3: MapToSchema
    input:  sample rows, existing domain schema
    tool:   LLM — propose flattenRow mapping
    output: mapped rows, confidence score, flattenRow map

  step 4: StoreAndRegister
    input:  mapped rows, source metadata
    action: store rows, write ApiAvailability entry
    output: { data, fallback, newSource }
```

### Key differences from Phase 8

| | Phase 7b Shadow Adapter | Phase 8 Domain Discovery |
|---|---|---|
| Trigger | Empty result or fetch failure on known domain | No matching domain at all |
| Schema change | None — maps to existing schema | New Prisma model + migration |
| Speed | Fast on warm path | Always involves agent overhead |
| Scope | Enriches existing domains | Creates entirely new domains |
| Risk | Low — existing pipeline unchanged | Higher — schema generation involved |

Phase 7b should be built before Phase 8. Most data gaps are coverage gaps within existing domains, not missing domain types — the shadow adapter resolves them more cheaply.

### Tech stack

| Concern | Library |
|---|---|
| Agent orchestration | `@mastra/core` |
| Browser automation | Stagehand by Browserbase |
| Format autodetection | custom — content-type + byte sniffing |
| LLM schema mapping | DeepSeek (existing) |
| Workflow persistence | Mastra built-in state |

### Key files

```
apps/orchestrator/src/agent/
  shadow-adapter.ts           ← ShadowAdapter class, isEnabled(), recover()
  workflows/
    shadow-recovery.ts        ← Mastra workflow definition
  steps/
    search-alternatives.ts    ← Stagehand search step
    sample-and-detect.ts      ← provider autodetect + sample fetch
    map-to-schema.ts          ← LLM flattenRow proposal
    store-and-register.ts     ← ApiAvailability write
```

---

## Phase 8 — Agentic Domain Discovery

**Goal:** When a user query cannot be matched to any registered domain, an agent automatically discovers suitable public data sources, proposes a schema, and registers a new domain — reducing the manual effort of adding new data types to zero for straightforward sources.

### What it does

- Intercepts failed `getDomainForQuery` calls in the execute pipeline
- Hands off to a Mastra workflow with four sequential steps:
  1. **Discover** — Stagehand searches for public data sources matching the user's intent and country, returning candidate URLs and format hints
  2. **Sample** — fetches a small sample from each candidate using the appropriate provider
  3. **Analyse** — an LLM reviews the samples and proposes a unified schema covering all sources, expressed as a `DomainConfig` with a `sources` array and per-source `flattenRow` maps
  4. **Register** — generates the Prisma model, runs the migration, calls `createGenericAdapter`, and registers the new domain
- Includes a mandatory human-in-the-loop review step before registration in all environments. The review presents the proposed `DomainConfig`, sample mapped rows, and confidence score — a human must approve before the migration runs and the domain is registered. This gate can be relaxed to optional in a future release once the agent's schema proposal accuracy is proven against a held-out test set of known domains
- On successful registration, retries the original query automatically
- Logs all discovery attempts to a new `DomainDiscovery` audit table

### Tech stack

| Concern | Library |
|---|---|
| Agent orchestration | `@mastra/core` |
| Browser automation / scraping | Stagehand by Browserbase |
| LLM for schema proposal | DeepSeek (existing) |
| Migration execution | Prisma (existing) |
| Workflow persistence | Mastra's built-in workflow state |

### Key files

```
apps/orchestrator/src/agent/
  pipeline.ts                 ← Mastra workflow definition
  steps/
    discover.ts               ← Stagehand discovery step
    sample.ts                 ← multi-format sample fetch
    analyse.ts                ← LLM schema proposal
    register.ts               ← migration + adapter registration
  tools/
    searchWeb.ts
    fetchUrl.ts
    runMigration.ts
    registerDomain.ts
packages/database/prisma/
  schema.prisma               ← DomainDiscovery audit model
```

---

## Phase 9 — Multi-Source Domain Enrichment

**Goal:** Allow a single domain to draw from multiple heterogeneous sources simultaneously — for example, combining a REST API with a weekly CSV update and a scraped supplement — with automatic deduplication and conflict resolution.

### What it does

- Extends the `GenericAdapter` to handle source priority and deduplication: when two sources provide the same logical record, a configurable merge strategy determines which fields win
- Adds a `sourceTag` field to all result tables so rows can be traced back to their origin source
- Introduces a background refresh scheduler: sources with `refreshPolicy: "daily"` or `"weekly"` are re-fetched on a cron schedule and merged into the existing result set without invalidating cached query results
- Adds a `DataSource` admin view in the frontend showing which sources are active per domain, their last refresh time, and row counts contributed

### Tech stack

| Concern | Library |
|---|---|
| Background scheduling | `node-cron` |
| Deduplication | custom — hash on stable identifier fields |
| Admin UI | React (existing frontend) |
| Source tracing | new `source_tag` column on result tables |

---

## Phase 10 — Semantic Query Layer

**Goal:** Move beyond keyword and category matching to semantic understanding of what the user wants, enabling queries that span implicit concepts ("deprivation", "liveability", "safety") and returning results from whichever domains best answer the question.

### What it does

- Replaces the current keyword-based intent detection in `crime/intent.ts` with an embedding-based semantic classifier
- Each registered domain has a set of example queries embedded at registration time and stored in `pgvector`
- At parse time, the user's query is embedded and compared against all domain example embeddings — the closest match wins, with a confidence score
- Queries that score below a confidence threshold are flagged for agent-assisted domain discovery (Phase 8)
- Introduces **composite intents**: a query like "is this area safe to live in?" can resolve to multiple domains (crime + air quality + housing) and return a structured multi-domain summary rather than a single result set. Each domain returns its own result; a synthesis LLM produces a unified narrative

### Tech stack

| Concern | Library |
|---|---|
| Vector storage | `pgvector` PostgreSQL extension |
| Embeddings | OpenAI `text-embedding-3-small` or DeepSeek equivalent |
| Similarity search | Prisma `$queryRaw` with `<=>` operator |
| Multi-domain synthesis | DeepSeek (existing) |

### Key schema additions

```prisma
model DomainEmbedding {
  id         String   @id @default(cuid())
  domain     String
  exampleQuery String
  embedding  Unsupported("vector(1536)")
  createdAt  DateTime @default(now())
  @@map("domain_embeddings")
}
```

---

## Phase 11 — Collaborative Workspaces

**Goal:** Allow teams to share saved queries, annotate results, and build persistent dashboards from multiple queries — moving DREDGE from a single-session tool to a persistent analytical workspace.

### What it does

- Introduces **workspaces**: named collections of saved queries, each with a title, notes, and pinned visualisations
- Saved queries store the full execute request body and response so they can be replayed or shared without re-fetching
- Annotations: users can attach text notes to any result, visible to workspace members
- Persistent dashboards: a workspace dashboard assembles multiple pinned query results into a single scrollable page — crime map + weather panel + any future domain side by side
- Export workspace as a PDF report with all visualisations and annotations rendered

### Tech stack

| Concern | Library |
|---|---|
| Auth | `better-auth` or Clerk |
| Workspace persistence | Prisma (new models) |
| PDF report generation | Puppeteer (headless render of dashboard) |
| Real-time collaboration | Liveblocks or PartyKit (optional) |

### Key new Prisma models

```
Workspace        — id, name, ownerId, createdAt
WorkspaceQuery   — id, workspaceId, queryId, title, notes, pinnedAt
WorkspaceMember  — workspaceId, userId, role
Annotation       — id, queryId, userId, body, createdAt
```

---

## Phase 12 — Public Data Marketplace

**Goal:** Allow domain configurations and adapters generated by the agent pipeline (Phase 8) to be published, rated, and reused across DREDGE instances — building a shared library of community-contributed data sources.

### What it does

- Registered domains can be exported as a portable `DomainPackage`: config JSON + migration SQL + optional adapter code
- A hosted registry (separate service) accepts package submissions and serves them via API
- On startup, DREDGE can optionally pull packages from the registry for intents it doesn't currently have registered
- Packages are versioned and signed; a trust score is derived from community ratings and usage count
- The agent pipeline (Phase 8) checks the registry before attempting autonomous discovery — reusing a community-validated package is faster and more reliable

### Security requirements

Phase 12 must be preceded by a security audit of the `GenericAdapter` and all `Provider` implementations. Community-submitted `DomainConfig` packages must not be able to:

- Execute arbitrary code during `fetchData` or `flattenRow`
- Access environment variables or the filesystem outside permitted paths
- Make requests to internal network addresses (SSRF prevention)
- Write to Prisma models outside the domain's declared `tableName`

A sandboxed execution environment (e.g. isolated VM context or a separate worker process with restricted permissions) should be evaluated before the marketplace accepts external submissions. Package signing alone is insufficient — validation must happen at execution time, not just at submission time.

### Tech stack

| Concern | Library / approach |
|---|---|
| Package registry | Separate Express service + Postgres |
| Package signing | Node `crypto` (existing pattern) |
| Registry client | New `RegistryProvider` in orchestrator |
| Trust scoring | simple weighted average — ratings × usage |

---

## Dependency Order & Parallel Tracks

Development can proceed on three independent tracks simultaneously after v6.1 stabilisation is complete.

### Track A — Data Engine
Maximises data coverage and reduces engineering overhead for new sources.

```
v6.1  — Redis shared state                    ← prerequisite for all tracks
  └─ Phase 7   — Provider layer               ← foundation
       └─ Phase 7b — Shadow adapter           ← low-risk agentic entry point
            └─ Phase 8  — Domain discovery    ← full autonomy
                 └─ Phase 9 — Enrichment      ← multi-source per domain
```

### Track B — Platform
Unlocks the commercial model. Independent of Track A — can start immediately after v6.1.

```
v6.1  — Redis shared state
  └─ Phase 11 — Collaborative workspaces      ← auth, saved state, teams
       └─ Phase 12 — Data marketplace         ← requires Track A Phase 8 + Phase 11
```

### Track C — Intelligence
Improves query success rates and enables concept-level queries. Independent of both Track A and Track B.

```
v6.1  — Redis shared state
  └─ Phase 10 — Semantic query layer          ← embeddings, pgvector, composite intents
```

### Recommended sequencing

| Priority | Phase | Rationale |
|---|---|---|
| 1 | v6.1 Redis | Unblocks scaling; low risk; short |
| 2 | Phase 7 Provider layer | Foundation — all tracks depend on it |
| 2 | Phase 11 Workspaces | Parallel with Phase 7; unlocks monetisation |
| 2 | Phase 10 Semantic layer | Parallel with Phase 7; improves core UX |
| 3 | Phase 7b Shadow adapter | First agentic feature; low risk |
| 4 | Phase 8 Domain discovery | High value; requires 7 + 7b |
| 5 | Phase 9 Enrichment | Requires 7 + 7b + 8 |
| 6 | Phase 12 Marketplace | Requires Phase 8 + 11; security audit first |

---

## Guiding Principles (carried forward from v4.1)

- `query.ts` remains domain-agnostic — it calls adapter hooks, never domain logic
- Adding a new domain requires no changes to existing files
- Every result table retains a `raw Json?` column — no data is ever lost
- Failures in non-critical paths never propagate to the core execute response
- One query resolves to one primary result set and one visualisation — datasets are not combined in a single chart unless explicitly designed for it (Phase 10 composite intents are a structured exception)
- The LLM extracts intent only — it never produces coordinates, fabricates data, or makes schema decisions without a validation step
