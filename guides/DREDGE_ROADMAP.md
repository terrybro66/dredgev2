# DREDGE — Engineering Roadmap

> Current as of March 2026. Tracks legacy cleanup, architectural decisions, and the feature build-out from the design spec.

---

## Part 1 — Legacy Cleanup

These changes addressed the technical debt from the single-domain origin of the codebase, where crime was structurally special and its assumptions were baked into the core pipeline.

### 1.1 Remove crime-as-default intent fallback ✅ Done

**Problem:** `query.ts` defaulted unrecognised queries to `intent = "crime"` via a hardcoded keyword list. The semantic classifier existed but was only applied on top of the keyword result, not as the sole routing mechanism.

**Changes made:**
- Removed the hardcoded `crimeKeywords` and `weatherMatch` blocks from `query.ts`
- Changed `intent ?? "crime"` to `intent ?? "unknown"`
- The semantic classifier is now the sole intent resolver — failure leaves `intent` as `undefined`, which correctly triggers discovery rather than misrouting to crime
- Two tests updated in `query.test.ts` to assert `undefined` intent on low-confidence classification and correct intent on high-confidence classification

---

### 1.2 Move shared utilities out of `src/crime/intent.ts` ✅ Done

**Problem:** `parseIntent`, `deriveVizHint`, and `expandDateRange` were domain-agnostic utilities living inside the crime module. Every non-crime path imported from `./crime/intent`, making crime structurally central to the codebase.

**Changes made:**
- Created `src/intent.ts` as the canonical home for all three functions plus `stripFences`
- Removed crime-specific language from the LLM system prompt (`all-crime` default → `unknown`, crime category slug list removed)
- Changed `deriveVizHint` default parameter from `"crime"` to `"unknown"`
- `src/crime/intent.ts` replaced with a one-line re-export shim pointing to `../intent`
- Import in `query.ts` updated from `./crime/intent` to `./intent`
- `intent.test.ts` import path updated — no assertion changes

---

### 1.3 Eliminate `src/crime/` directory ✅ Done

**Problem:** `src/crime/` implied crime was architecturally special. The correct structure treats every domain as a peer under `src/domains/`.

**Changes made:**

New structure:
```
src/
  domains/
    crime-uk/
      fetcher.ts      (moved from src/crime/fetcher.ts)
      store.ts        (moved from src/crime/store.ts)
      recovery.ts     (moved from src/crime/recovery.ts)
      index.ts        (moved from src/domains/crime-uk.ts)
    weather/
      index.ts        (moved from src/domains/weather.ts)
    registry.ts
  intent.ts
```

All internal imports updated for the new depth. `src/crime/` deleted entirely.

**Bug fixed during this change:** `store.ts` imported `../schema` which became `../../schema` after moving one level deeper — caught by running the baseline test suite after the move.

---

### 1.4 Move `loadAvailability` into crime-uk adapter `onLoad` hook ✅ Done

**Problem:** `src/index.ts` contained a hardcoded call to `loadAvailability` with the police API URL — domain-specific knowledge in the server entry point.

**Changes made:**
- Added optional `onLoad?: () => void | Promise<void>` to the `DomainAdapter` interface in `registry.ts`
- `loadDomains()` made async — calls `adapter.onLoad()` after each registration
- Crime-uk adapter now owns its own `onLoad` which calls `loadAvailability` with the police URL
- `src/index.ts` now calls `await loadDomains()` inside an async `start()` function — `loadAvailability` import and call removed
- **Side effect fixed:** Previously there was a race condition where the server could receive a recovery query before availability data was loaded. The `onLoad` hook runs before `app.listen` so availability is always populated on first request.

---

## Part 2 — Architecture Decision

### 2.1 Hybrid storage model — decided ✅

**Decision:** Replace per-domain tables with a single `query_results` table using a hybrid schema.

**Rationale:** The original design had domains and data sources conflated — each new domain required a schema migration and a new Prisma model. Approach C (pre-provisioned fixed schema) avoids migration hell but hits a ceiling on complex data types. The hybrid approach gives the benefits of Approach C while handling domain-specific fields without migrations.

**Schema:**
```sql
id            uuid
domain_name   text
source_tag    text
date          timestamptz
lat           float
lon           float
location      text
description   text
value         float
raw           jsonb       -- full original payload, never lost
extras        jsonb       -- domain-specific structured fields, no migration needed
snapshot_id   uuid
created_at    timestamptz
```

**Field map convention:** DataSource field maps support two target namespaces:
- Top-level columns: `"showtime" → "date"`
- Extras keys: `"certificate" → "extras.certificate"`

**Status:** Decision made, migration not yet written. Blocked on: nothing — this is next.

---

---

### 2.2 Hybrid model governance

Rules for keeping the hybrid storage model maintainable as the domain count grows. These apply to every domain added — discovered, curated, or manual.

---

#### Rule 1 — Keep core schema small and stable

The core columns exist for fields that are universal, indexed, and queried directly. Do not expand them speculatively.

**Current core columns:**

| Column | Type | Notes |
|---|---|---|
| `date` | `timestamptz` | Primary time axis for all domains |
| `lat` / `lon` | `float` | PostGIS spatial queries |
| `location` | `text` | Human-readable place name |
| `description` | `text` | Primary human-readable content field |
| `value` | `float` | Nullable — numeric measurement only, not a catch-all |
| `category` | `text` | Sub-classification within a domain (e.g. crime type, weather condition). Missing from the original field list — needed immediately |
| `raw` | `jsonb` | Full original payload, never lost |
| `extras` | `jsonb` | Domain-specific structured fields |

`value` is a nullable float for numeric measurements only. Domains whose primary data is textual (cinema listings, planning applications) leave it null and use `description` and `extras`.

**Promotion trigger:** When a field appears in `extras` across five or more domains it becomes a candidate for promotion to a core column. Promotion requires a single migration plus a backfill on `query_results` — far cheaper than the per-domain table approach where the same promotion would require N separate migrations.

---

#### Rule 2 — Enforce structure in `extras`

`extras` is JSONB but must not be treated as a free-form dump. Each domain must declare an extras schema at registration time. This schema is proposed by the LLM during discovery (the `proposeDomainConfig` prompt should be extended to include it) and stored on the `DataSource` record as an `extrasSchema` JSON column.

**Example extras schema for cinema listings:**
```json
{
  "certificate": "string",
  "runtime_mins": "number",
  "screen_type": "string",
  "booking_url": "string"
}
```

Rows are validated against this schema on write. Validation failures are logged as warnings and the offending field is omitted — rows are never rejected entirely, since `raw` preserves the full original payload.

**Type conflicts:** If `certificate` is stored as `"12A"` (string) by one source and as `{ "code": "12A", "authority": "BBFC" }` (object) by another, you have a type conflict across rows in the same domain. The extras schema prevents this within a domain. The canonical vocabulary (Rule 3) prevents it across domains.

---

#### Rule 3 — Standardise naming via canonical vocabulary

The fieldMap normalises source-specific field names to standard names at write time. But nothing prevents two domains from mapping the same concept to different extras keys (`cert`, `rating`, `certificate`) unless a canonical vocabulary is enforced.

**Canonical extras key vocabulary (initial list):**

| Concept | Canonical key | Type |
|---|---|---|
| Film/content age rating | `certificate` | `string` |
| Running time | `runtime_mins` | `number` |
| Price / admission cost | `price_gbp` | `number` |
| Planning decision | `decision_code` | `string` |
| Appeal reference | `appeal_reference` | `string` |
| Transport operator | `operator` | `string` |
| Route identifier | `route_id` | `string` |
| Screen or venue type | `venue_type` | `string` |

The LLM prompt in `proposeDomainConfig` must reference this vocabulary when proposing a field map. New canonical keys are added here as new domains are registered — this list is the authoritative source, not convention.

---

#### Rule 4 — Selective indexes only

Full GIN indexes on `extras` are expensive and rarely needed. Add functional indexes only on specific extracted keys, and only for domains where that key is actively queried.

**Pattern:**
```sql
CREATE INDEX ON query_results ((extras->>''certificate''))
WHERE domain_name = '''cinema-listings-gb'';
```

**When to add:** At domain registration time, via an optional `indexFields` array on the approve request body. The registration step applies the indexes post-insert.

**Never** index the entire `extras` column with a blanket GIN index unless benchmarking proves it necessary.

---

#### Rule 5 — Promote to core when a field becomes universal

If a field appears in `extras` across five or more domains it should be promoted to a top-level core column. This keeps performance strong for the fields that matter most.

**Process:**
1. Identify the field via a query across `DataSource.extrasSchema` records
2. Add the column to the `query_results` migration
3. Backfill from `extras` for existing rows
4. Update the canonical vocabulary to mark the key as promoted
5. Update the fieldMap convention — new sources map directly to the core column, not `extras`

---

#### Rule 6 — Extras key versioning

If the type or structure of an extras key changes between source versions — e.g. `certificate` changes from a plain string to a structured object — rows written before and after the change will have incompatible types for the same key. Queries that cast `extras->>''certificate'''` will silently return null for the new format.

**Mitigation:**
- The extras schema on `DataSource` is versioned. A schema change requires a new schema version, not an in-place edit.
- The admin approval step flags any proposed extras schema that conflicts with an existing schema for the same domain name.
- Application code reading `extras` fields must handle both old and new formats during any transition window.


## Part 3 — Feature Build-out

These items follow the dependency order from the design spec. Each must pass its full test suite before the next begins.

---

### 3.0 `proposeDomainConfig` ephemeral fields ✅ Done

**What:** Extended the LLM prompt and `ProposedDomainConfig` interface to return `storeResults`, `refreshPolicy`, and `ephemeralRationale`. Updated `DomainDiscovery` record to store these as top-level columns.

**Why first:** Every downstream step — registration, ephemeral bypass, admin endpoint — depends on `storeResults` being present in the proposed config. Without it the registration step cannot branch correctly.

**Changes made:**
- `ProposedDomainConfig` interface extended with `storeResults: boolean`, `refreshPolicy: "realtime" | "daily" | "weekly" | "static"`, `ephemeralRationale: string`
- LLM prompt updated to explicitly ask for ephemeral/persistent decision with examples (cinema showtimes → ephemeral, crime statistics → persistent)
- Defaults: `storeResults: true`, `refreshPolicy: "weekly"`, `ephemeralRationale: ""`
- `domainDiscovery.update` now writes `store_results`, `refresh_policy`, `ephemeral_rationale` as top-level columns so the admin endpoint can query them without parsing the JSON blob
- New test: asserts that an ephemeral proposed config (`storeResults: false`) is stored correctly on the record

---

### 3.1 Hybrid `query_results` table migration 🔲 Next

**What:** Write the Prisma migration for the hybrid storage table and update the execute pipeline to write to it.

**Prereqs:** Architecture decision (2.1) ✅

**Scope:**
- Add `query_results` model to `packages/database/prisma/schema.prisma`
- Write migration
- Update `evolveSchema` — no longer needed for new domains, but must remain for the existing `crime_results` and `weather_results` tables during transition
- Update `query.ts` map/heatmap raw query to use `query_results` instead of hardcoded `crime_results`
- Fix `orderBy: { month: "asc" }` — currently hardcoded, breaks weather queries (bug confirmed in dev logs)

**Immediate bug:** Weather queries are failing in dev with `Unknown argument 'month'` because the execute handler hardcodes `orderBy: { month: "asc" }`. Quick fix: add `defaultOrderBy` to `DomainConfig` and use it in `query.ts`. Proper fix: the hybrid table migration eliminates the problem entirely.

---

### 3.2 DataSource model ⬜ Blocked on 3.1

**What:** Add the `DataSource` Prisma model as a first-class database entity, separate from the domain config JSON.

**Schema** (from design spec):
```
DataSource
  id                String
  domainName        String   (FK to domain registry)
  name              String
  url               String
  type              Enum     rest | csv | xlsx | pdf | scrape
  extractionPrompt  String?
  fieldMap          Json
  refreshPolicy     Enum     realtime | daily | weekly | static
  storeResults      Boolean
  confidence        Float
  enabled           Boolean
  discoveredBy      Enum     manual | catalogue | serp | browser
  approvedAt        DateTime?
  lastFetchedAt     DateTime?
  lastRowCount      Int?
  createdAt         DateTime
```

**Why now:** Required before the registration step can write anything. Without this model the registration step has nowhere to record the new source.

---

### 3.3 Admin approval endpoint ⬜ Blocked on 3.2

**What:** Three routes for human review of discovered domains.

- `GET /admin/discovery` — lists all `requires_review` records with intent, proposed domain name, sample rows, confidence, `storeResults`, `ephemeralRationale`, and proposed field map
- `POST /admin/discovery/:id/approve` — applies optional overrides, triggers registration step
- `POST /admin/discovery/:id/reject` — marks rejected with reason, removed from review queue

**Override body example:**
```json
{ "overrides": { "storeResults": true, "refreshPolicy": "daily" } }
```

**Auth:** `better-auth` is installed but not wired to any routes. Admin routes are the first place authentication must be enforced.

---

### 3.4 Registration — ephemeral path ⬜ Blocked on 3.3

**What:** The simpler registration branch. When `storeResults: false`:
1. Validate config
2. Create `DataSource` record with `storeResults: false`
3. Register a fetch-and-discard adapter (no table, no cache, no snapshot)
4. Mark `DomainDiscovery` record as `registered`

Build and fully test this before touching the persistent path.

---

### 3.5 Ephemeral pipeline enforcement ⬜ Blocked on 3.4

**What:** When the matched adapter has `storeResults: false`, the execute pipeline must skip:
- Cache write
- Snapshot creation
- Result table write

Return live results directly. This must be locked before any ephemeral sources are added to the curated registry — otherwise cinema showtimes silently get written to the database.

---

### 3.6 Registration — persistent path ⬜ Blocked on 3.5

**What:** The full registration branch. When `storeResults: true`:
1. Create domain entry if it doesn't exist
2. Create `DataSource` record linked to the domain
3. Register full `GenericAdapter` with storage using the hybrid `query_results` table
4. Mark `DomainDiscovery` record as `registered`

---

### 3.7 Curated source registry ⬜ Blocked on 3.5

**What:** A manually maintained TypeScript array of known-good data sources, wired into the query pipeline between the registered adapter lookup and the discovery pipeline.

**Value:** Instant coverage for common queries (cinema chains, government REST APIs, transport data) without any LLM calls, browser automation, or human review. High ROI — covers the majority of common queries immediately.

**Seed sources to include:**
- Odeon, Vue, Cineworld (cinema listings — ephemeral)
- Environment Agency flood risk API (persistent)
- TfL API (transport — realtime/ephemeral)
- ONS data APIs (various — persistent)

**Note:** Must not be built until 3.5 is complete. Ephemeral sources in the registry writing to the database silently would be a significant bug.

---

### 3.8 ScrapeProvider ⬜ Blocked on 3.6

**What:** Add `type: "scrape"` to the provider system. Wire into `GenericAdapter` and `sampleSource`. Use the Stagehand pattern established in `miniTest.ts`.

**Key implementation notes from spec:**
- Standalone Stagehand with `model` as a config object using OpenRouter as base URL
- `stagehand.context.pages()` to get the page
- `stagehand.extract(prompt, schema, { page })` for extraction
- All optional fields must use `nullable()` in the schema
- Fall back to parsing raw text from `NoObjectGeneratedError` before giving up

---

### 3.9 Source scoring ⬜ Blocked on 3.7

**What:** Extend the `confidence` field on `DataSource` with dynamic scoring:
- Penalise failed fetches
- Boost sources with consistent successful fetch history
- Rank outputs when multiple sources cover the same domain

**Why:** Without scoring, low-quality or intermittently failing sources pollute results with no mechanism for the system to learn which sources are reliable.

---

### 3.10 Auto-approval threshold ⬜ Blocked on 3.9

**What:** Introduce automatic approval for low-risk discovered sources, bypassing human review:
- Auto-approve: REST APIs from known government domains, confidence > 0.9
- Manual review: scraping sources, confidence < 0.9, novel source types

**Safety note:** This has security implications — an incorrectly auto-approved domain could silently corrupt results. The threshold and criteria must be decided deliberately and the auto-approval path should be auditable.

---

### 3.11 Source-level URL routing ⬜ Blocked on 3.7

**What:** Location routing support on `DataSource` for sources requiring location-specific URL slugs.

**Example problem:** Odeon URLs follow `https://www.odeon.co.uk/cinemas/{location}/` where `{location}` is a cinema-specific slug like `braehead` — not a geocoder place name. A mapping from place names to cinema slugs is needed per source.

---

### 3.12 Frontend ephemeral label ⬜ Blocked on 3.5

**What:** For results from ephemeral adapters:
- Show "Live data · not saved" label
- Suppress workspace save button
- Suppress export for ephemeral results

---

## Known Bugs

| Bug | Severity | Status |
|---|---|---|
| Weather queries fail with `Unknown argument 'month'` in `orderBy` | High | Open — quick fix available, proper fix via 3.1 |
| Catalogue search returns stale 2017 datapress.com URLs that fail sampling | Medium | Open — catalogue needs dead-link filtering |
| `src/crime/intent.ts` shim still exists as a re-export | Low | Open — delete once all imports confirmed updated |

---

## Architectural Principles

These constraints are established and must be respected by all future changes:

- **`query.ts` is domain-agnostic.** The execute handler calls adapter hooks and never contains domain-specific logic.
- **Every result row preserves raw data.** The `raw` JSONB column on `query_results` means no information is ever lost.
- **Failures in non-critical paths never propagate.** Discovery, shadow adapter, and classifier failures return empty or `undefined` — never 500s.
- **Workspace dashboards render from pinned snapshots.** Results must not change between sessions without explicit user action.
- **The LLM extracts intent only.** All LLM output is a proposal that must pass schema validation before use.
- **Intent summary, not raw query, drives discovery.** The distilled 2–4 word concept flows into catalogue search and Stagehand — not the raw user query.
- **Ephemeral enforcement before ephemeral sources.** No curated or discovered ephemeral source should be added until the pipeline bypass (3.5) is proven and locked.
