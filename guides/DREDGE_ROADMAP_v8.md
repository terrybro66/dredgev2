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

## Current Implementation Status (as of 2026-03-18)

Based on the codebase, the following phases have been partially or fully implemented:

| Phase | Status | Notes |
|-------|--------|-------|
| v6.1 — Redis shared state | **Completed** | Redis‑backed rate limiter and availability cache implemented (commit a42e5e9). |
| Phase 7 — Provider layer | **In progress** | `Provider` interface exists; CSV, XLSX, PDF providers not yet implemented. |
| Phase 7b — Shadow adapter | **Not started** | No shadow‑adapter files present. |
| Phase 8 — Domain discovery | **In progress** | Discovery interfaces (`DiscoveryContext`, `DiscoveredSource`) are defined; Mastra workflow not yet built. |
| Phase 8.5 — Execution model | **In progress** | `CreateSnapshotOptions` interface exists; `QueryRun` and `DatasetSnapshot` models not yet in schema. |
| Phase 9 — Multi‑source enrichment | **Partially started** | Deduplication and source‑tagging utilities exist; background scheduler and source merging not implemented. |
| Phase 10 — Semantic query layer | **Not started** | No embedding or pgvector integration. |
| Phase 11 — Collaborative workspaces | **Not started** | Auth interface present; workspace models and snapshot pinning absent. |
| Phase 12 — Public data marketplace | **Not started** | |
| Phase 13 — Query result abstraction | **Deferred** | As planned. |

The **next recommended step** is to start **Phase 7 (Provider Layer)**. Begin by installing the required dependencies (papaparse, xlsx, pdf‑parse) and creating the provider interface tests.

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
    fetchUrl.ts
    runMigration.ts
    registerDomain.ts
packages/database/prisma/
  schema.prisma               ← DomainDiscovery audit model
```

---

## Phase 8.5 — Query Execution Model

**Goal:** Introduce immutable query execution records and dataset snapshots before workspaces are built, so that dashboards, collaborative reports, and background refresh jobs all operate on stable, auditable data — not on mutable result state that silently changes as new sources are discovered.

### The problem this solves

Phases 7b, 9, and 11 together create the conditions for a result consistency problem that is difficult to debug once it manifests in production. The chain is:

- Phase 7b discovers new sources and registers them to `ApiAvailability`
- Phase 9 runs a background scheduler that re-fetches and merges results on a cron
- Phase 11 builds workspaces where users pin visualisations and share reports

Without an execution model, the same logical query can silently return different data over time. A workspace dashboard pinned on Monday shows 120 crime incidents; by Wednesday the shadow adapter has registered a CSV supplement, the Phase 9 refresh job has run, and the live query returns 145. The pinned dashboard is now wrong, nobody knows why, and there is no way to reproduce the original result.

This is a well-known failure mode in analytics platforms. It tends to appear precisely when systems move from single-session query tools to collaborative workspaces — which is exactly the transition DREDGE makes at Phase 11. The fix is structurally cheap now and increasingly expensive after workspace data is in production.

### Core concept: separating definition from execution from data

The root cause is that the current model conflates three distinct concepts into one:

```
Query definition   →   "crime in Camden, Jan 2024"
Execution snapshot →   data retrieved on 2026-03-15, source: police_api
Mutable sources    →   police_api + csv_supplement (added 2026-03-16)
```

When a new source appears, the same query definition produces different results. The fix is to make each execution an immutable record that can be referenced independently of what happens to the underlying sources afterwards.

### What it does

Introduces two new entities — `QueryRun` and `DatasetSnapshot` — that sit between query execution and result storage.

**QueryRun** records each individual execution of a query:

```prisma
model QueryRun {
  id            String   @id @default(cuid())
  queryId       String
  executedAt    DateTime @default(now())
  sourceSet     String[] // URLs / identifiers of all sources used
  schemaVersion String   // domain schema version at time of execution
  status        String   // pending | complete | failed
  query         Query    @relation(fields: [queryId], references: [id])
  snapshot      DatasetSnapshot?
  @@map("query_runs")
}
```

**DatasetSnapshot** records the immutable result of that run:

```prisma
model DatasetSnapshot {
  id         String    @id @default(cuid())
  queryRunId String    @unique
  rowCount   Int
  checksum   String    // SHA-256 of serialised rows — detects silent mutation
  rows       Json      // immutable result payload
  createdAt  DateTime  @default(now())
  queryRun   QueryRun  @relation(fields: [queryRunId], references: [id])
  @@map("dataset_snapshots")
}
```

Workspaces introduced in Phase 11 reference snapshot IDs, not query IDs. A pinned visualisation always renders from its snapshot. It only updates when the user explicitly triggers a refresh, which creates a new `QueryRun` and a new `DatasetSnapshot` — leaving the previous one intact.

### How the execution pipeline changes

The change to `query.ts` is minimal. After rows are fetched and stored, the pipeline creates a run record and seals a snapshot:

```ts
// After rows are fetched:
const run = await prisma.queryRun.create({
  data: {
    queryId: plan.queryId,
    sourceSet: activeSources.map(s => s.url),
    schemaVersion: adapter.config.version,
    status: 'pending'
  }
});

const snapshot = await prisma.datasetSnapshot.create({
  data: {
    queryRunId: run.id,
    rowCount: rows.length,
    checksum: sha256(JSON.stringify(rows)),
    rows: rows
  }
});

await prisma.queryRun.update({
  where: { id: run.id },
  data: { status: 'complete' }
});
```

No other changes to the adapter layer, registry, or existing result tables are required at this phase.

### What this changes in downstream phases

**Phase 9 — background refresh scheduler**

Instead of mutating existing result rows in place, the refresh job creates a new `QueryRun` and `DatasetSnapshot` per domain per refresh cycle. The previous snapshot is retained. Dashboards continue to render from their pinned snapshot until the user chooses to update.

```
refresh job fires
  → create QueryRun (status: pending)
  → fetch rows from all active sources
  → create DatasetSnapshot (new immutable set)
  → update QueryRun (status: complete)
  → notify workspace members that a newer snapshot is available
```

**Phase 10 — composite intents**

Composite queries (e.g. crime + air quality + housing) assemble their result from multiple domain snapshots. The synthesis step records which snapshot ID from each domain was used, so the composite result is fully reproducible even if individual domain data is later refreshed.

**Phase 11 — collaborative workspaces**

Saved queries in workspaces store a `snapshotId` alongside the query request body. Pinned visualisations render from the snapshot. A "refresh" button triggers a new run and updates the pinned snapshot ID on user confirmation. Exported PDF reports embed the snapshot ID and execution timestamp so any result can be traced back to its exact source set and schema version.

**Phase 12 — marketplace**

If a community package updates its `flattenRow` mapping or changes a field name, existing snapshots are unaffected — they were sealed at execution time. Old workspace dashboards continue to work. New executions use the updated package version and produce new snapshots, which are clearly distinguished by their `schemaVersion` field.

### Why reproducibility matters specifically for DREDGE

DREDGE is being built toward collaborative public data analysis — repeatable reports, shared workspaces, and eventually auditable data lineage. These use cases require that a result produced on a given date can be reproduced exactly, regardless of what sources are discovered or refreshed afterwards. The snapshot model is the mechanism that guarantees this.

It also makes the shadow adapter and background refresh features significantly safer to ship: agent discoveries and scheduled re-fetches no longer carry the risk of silently invalidating work that users have already built on top of.

### Complexity cost

Low. Two tables (`query_runs`, `dataset_snapshots`), a SHA-256 checksum on rows, and a discipline of "workspaces reference snapshot IDs, not query IDs." The foreign key chain is:

```
Workspace → WorkspaceQuery → DatasetSnapshot → QueryRun → Query
```

This is the standard structure used by dbt, Hex, and most production BI tools. It adds no meaningful latency to the execute path.

### Key files

```
packages/database/prisma/
  schema.prisma               ← QueryRun, DatasetSnapshot models
apps/orchestrator/src/
  query.ts                    ← snapshot creation after row fetch
  refresh/
    scheduler.ts              ← updated to create new runs, not mutate rows
```

---

## Phase 9 — Multi-Source Domain Enrichment

**Goal:** Allow a single domain to draw from multiple heterogeneous sources simultaneously — for example, combining a REST API with a weekly CSV update and a scraped supplement — with automatic deduplication and conflict resolution.

### What it does

- Extends the `GenericAdapter` to handle source priority and deduplication: when two sources provide the same logical record, a configurable merge strategy determines which fields win
- Adds a `sourceTag` field to all result tables so rows can be traced back to their origin source
- Introduces a background refresh scheduler: sources with `refreshPolicy: "daily"` or `"weekly"` are re-fetched on a cron schedule. Following the execution model introduced in Phase 8.5, each refresh cycle creates a new `QueryRun` and `DatasetSnapshot` rather than mutating existing result rows — active workspace dashboards are notified that a newer snapshot is available but are not silently updated
- Adds a `DataSource` admin view in the frontend showing which sources are active per domain, their last refresh time, and row counts contributed per snapshot

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
- Introduces **composite intents**: a query like "is this area safe to live in?" can resolve to multiple domains (crime + air quality + housing) and return a structured multi-domain summary rather than a single result set. Each domain returns its own result, drawing from its most recent snapshot; a synthesis LLM produces a unified narrative. The composite result records which snapshot ID from each domain was used, making it fully reproducible

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
  id            String   @id @default(cuid())
  domain        String
  exampleQuery  String
  embedding     Unsupported("vector(1536)")
  createdAt     DateTime @default(now())
  @@map("domain_embeddings")
}
```

---

## Phase 11 — Collaborative Workspaces

**Goal:** Allow teams to share saved queries, annotate results, and build persistent dashboards from multiple queries — moving DREDGE from a single-session tool to a persistent analytical workspace.

### What it does

- Introduces **workspaces**: named collections of saved queries, each with a title, notes, and pinned visualisations
- Saved queries store the full execute request body alongside a `snapshotId` — the pinned visualisation always renders from the snapshot taken at save time, not from a live re-execution. A "refresh" button triggers a new `QueryRun`, produces a new `DatasetSnapshot`, and updates the pinned snapshot ID on user confirmation
- Annotations: users can attach text notes to any result, visible to workspace members
- Persistent dashboards: a workspace dashboard assembles multiple pinned query snapshots into a single scrollable page — crime map + weather panel + any future domain side by side. All panels reflect a consistent, stable state; they do not change between sessions unless explicitly refreshed
- Export workspace as a PDF report with all visualisations and annotations rendered. Each exported report embeds the snapshot ID and execution timestamp for every panel, so any result can be traced back to its exact source set and schema version

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
WorkspaceQuery   — id, workspaceId, queryId, snapshotId, title, notes, pinnedAt
WorkspaceMember  — workspaceId, userId, role
Annotation       — id, queryId, userId, body, createdAt
```

Note: `WorkspaceQuery` carries a `snapshotId` foreign key to `DatasetSnapshot` (introduced in Phase 8.5). This is the mechanism that makes workspace dashboards stable between sessions.

---

## Phase 12 — Public Data Marketplace

**Goal:** Allow domain configurations and adapters generated by the agent pipeline (Phase 8) to be published, rated, and reused across DREDGE instances — building a shared library of community-contributed data sources.

### What it does

- Registered domains can be exported as a portable `DomainPackage`: config JSON + migration SQL + optional adapter code
- A hosted registry (separate service) accepts package submissions and serves them via API
- On startup, DREDGE can optionally pull packages from the registry for intents it doesn't currently have registered
- Packages are versioned and signed; a trust score is derived from community ratings and usage count
- The agent pipeline (Phase 8) checks the registry before attempting autonomous discovery — reusing a community-validated package is faster and more reliable
- Because all query results are stored as immutable snapshots (Phase 8.5), a package version update does not affect existing workspace dashboards. Old snapshots were sealed at execution time against a specific `schemaVersion`. New executions use the updated package and produce new snapshots, which are clearly distinguished in the audit trail

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

## Phase 13 — Query Result Abstraction Layer *(deferred)*

**Goal:** Replace the current domain-per-table result storage model with a universal `QueryResult` envelope, turning DREDGE from a collection of domain adapters into a generalised public data engine.

> **Note:** This phase is intentionally deferred until after the marketplace (Phase 12) is live and the schema surface area has grown to the point where the complexity cost of per-domain tables is demonstrably felt. The abstraction is architecturally sound — it simplifies multi-source enrichment, composite intents, marketplace security, and agentic discovery — but it is a breaking change to result storage and is cheapest when it replaces a pain point rather than a theoretical one. The right trigger for this phase is one of: (a) Phase 12 marketplace packages requiring schema migrations that feel risky, (b) Phase 10 composite queries becoming difficult to synthesise across divergent domain schemas, or (c) the domain table count reaching a maintenance threshold that the team finds genuinely burdensome.

### What it does (outline — to be fully specified when scheduled)

Introduces a standardised `QueryResult` envelope as the universal output of all adapters:

```ts
type QueryResult = {
  id: string
  queryId: string
  domain: string
  location?: {
    lat: number
    lon: number
    polygon?: GeoJSON
  }
  metrics: Record<string, number>
  attributes: Record<string, string | number | boolean>
  timestamp?: Date
  source: {
    provider: "rest" | "csv" | "scrape"
    url?: string
  }
  raw?: unknown
}
```

All adapters output this structure instead of domain-specific rows. Results are stored in a single `query_results` table with JSONB columns. Domain schema is stored as metadata rather than as database structure.

Key downstream benefits when implemented:

- Phase 9 multi-source deduplication becomes trivial: deduplicate on `domain + location + timestamp` across a single table
- Marketplace packages no longer ship migration SQL — they only define `flattenRow → QueryResult`. Security risk drops significantly
- Agentic domain discovery (Phase 8) no longer requires Prisma model generation or migrations — the agent only produces a `flattenRow` mapping
- Visualisations become metric-driven rather than domain-specific: `metric + geometry → map`, `metric + timestamp → time series`, `metric only → bar chart`

---

## Dependency Order & Parallel Tracks

Development can proceed on three independent tracks simultaneously after v6.1 stabilisation is complete.

### Track A — Data Engine
Maximises data coverage and reduces engineering overhead for new sources.

```
v6.1  — Redis shared state                    ← prerequisite for all tracks
  └─ Phase 7   — Provider layer               ← foundation
       └─ Phase 7b — Shadow adapter           ← low-risk agentic entry point
            └─ Phase 8   — Domain discovery   ← full autonomy
                 └─ Phase 8.5 — Execution model ← snapshot layer before workspaces
                      └─ Phase 9 — Enrichment ← multi-source per domain
```

### Track B — Platform
Unlocks the commercial model. Independent of Track A — can start immediately after v6.1.

```
v6.1  — Redis shared state
  └─ Phase 8.5 — Execution model              ← required before workspaces
       └─ Phase 11 — Collaborative workspaces ← auth, saved state, teams
            └─ Phase 12 — Data marketplace    ← requires Track A Phase 8 + Phase 11
                 └─ Phase 13 — Result abstraction ← deferred; triggered by marketplace pain
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
| 2 | Phase 10 Semantic layer | Parallel with Phase 7; improves core UX |
| 3 | Phase 7b Shadow adapter | First agentic feature; low risk |
| 4 | Phase 8 Domain discovery | High value; requires 7 + 7b |
| 5 | Phase 8.5 Execution model | Required before Phase 11; low complexity cost |
| 5 | Phase 11 Workspaces | Requires Phase 8.5; unlocks monetisation |
| 6 | Phase 9 Enrichment | Requires 7 + 7b + 8 + 8.5 |
| 7 | Phase 12 Marketplace | Requires Phase 8 + 11; security audit first |
| 8 | Phase 13 Result abstraction | Deferred; scheduled when marketplace pain is felt |

---

## Guiding Principles (carried forward from v4.1)

- `query.ts` remains domain-agnostic — it calls adapter hooks, never domain logic
- Adding a new domain requires no changes to existing files
- Every result table retains a `raw Json?` column — no data is ever lost
- Failures in non-critical paths never propagate to the core execute response
- One query resolves to one primary result set and one visualisation — datasets are not combined in a single chart unless explicitly designed for it (Phase 10 composite intents are a structured exception)
- The LLM extracts intent only — it never produces coordinates, fabricates data, or makes schema decisions without a validation step
- Workspace dashboards always render from a pinned snapshot — results do not change between sessions without explicit user action
