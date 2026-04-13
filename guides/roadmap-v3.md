# DREDGE Roadmap v3

Status as of April 2026. Strategy revised twice. v2 made crime the best single-domain experience — done. This roadmap addresses the original vision: a system that finds, connects, and explains public data.

Five pillars:

1. **The field map is the domain** — no domain is a special case; all domains are config rows
2. **Domain lifecycle** — discovery, approval, and registration work end-to-end
3. **Connected queries** — chip clicks execute real cross-domain queries
4. **Schema evolution** — new data shapes evolve the schema at runtime
5. **Insight** — the system synthesises across results, not just navigates between them

---

## Architectural Principle: The Field Map Is the Domain

The current architecture has cause and effect backwards. Domains exist as TypeScript files imported at startup. Discovery is a fallback. The code treats crime and weather as fundamentally different from discovered domains — dedicated tables, hand-coded adapters, per-domain TypeScript files.

**This distinction must not exist.** Crime is not special because of the police.uk API. It is special because someone hand-wrote the field mapping and recovery logic. Once that mapping is config, crime and "planning applications in Bristol" are the same thing: a URL, a shape template, and a field map.

The target architecture:

- A **domain** is a row in `data_sources`, not a TypeScript file
- A **shape template** defines the canonical mapping for a class of data
- The **generic adapter** handles all execution via config fields — no per-domain implementations
- `loadDomains()` queries the DB and creates generic adapters — no imports, no domain names in code
- **Discovery** picks the closest template, maps field names, inserts a config row — domain is immediately live

### Shape Templates

Six templates cover the data classes that public APIs return:

| Template | Canonical fields | Capabilities | Example domains |
|----------|-----------------|--------------|-----------------|
| `incidents` | date, lat, lon, category, description | has_coordinates, has_time_series, has_category | crime, accidents, noise complaints |
| `places` | lat, lon, name, description, category | has_coordinates, has_category | cinemas, restaurants, GP surgeries |
| `forecasts` | date, value, unit, description | has_time_series | weather, air quality, tidal |
| `boundaries` | GeoJSON geometry, name, properties | has_polygon | flood zones, conservation areas |
| `listings` | name, price, category, location, date | has_coordinates, has_category | planning applications, businesses |
| `regulations` | applies_to, condition, outcome | has_regulatory_reference | licences, eligibility rules |

Template shapes also enable smarter cross-domain suggestions without hand-curated relationship tables: `incidents` data naturally suggests nearby `places` and `boundaries` for context.

### Chips Are Questions, Not Actions

The current chip vocabulary is navigational:

> "Show on map" · "Get directions" · "Filter by category"

The target vocabulary is investigative:

> "Is crime higher in flood zones?" · "Are these areas improving over time?" · "What else nearby matters?"

This shift cannot happen all at once. But every chip design decision should ask: *is this guiding the user toward understanding, or just changing the view?* The Immediate phase wires chips so they work. Later phases make them ask better questions.

---

## Design Target: Three User Stories

Every roadmap item is justified by what it unblocks in at least one story.

### Story 1 — "I'm moving to Leeds"

> User asks: "crime in Leeds" → sees crime map → clicks "flood risk here" chip → sees flood data for the same area → clicks "food hygiene near me" → sees restaurants rated by hygiene score.

### Story 2 — "Friday night out"

> User asks: "cinemas near me" → sees venues on map → clicks "What's on here?" → sees showtimes → clicks "weather tonight" chip → sees weather for the same location.

### Story 3 — "Should I be worried?"

> User asks: "flood warnings in Bristol" → sees warnings → clicks "crime in this area" chip → sees crime data → system surfaces: "these areas overlap — 3 flood zones also have above-average burglary rates."

---

## Immediate — Walking Skeleton

**Goal:** Get connected queries working end-to-end in days, not weeks. These three items are independent of Phase 0 and deliver 80% of connected query value with a fraction of the effort. They work against the current architecture — no foundational refactor needed.

This is the walking skeleton pattern: build the simplest possible version of the full journey first. Then refactor foundations while users see working cross-domain chips.

### W.1 — Generic fetch_domain chip handler

**What:** Replace the 400 fallback in `/query/chip` with a generic handler:
1. Read `args.domain` from the chip
2. Look up the adapter via `getDomainByName(args.domain)` — works for any registered domain
3. Read session context for parent result's location/poly (see W.2)
4. Call `adapter.fetchData(plan, poly)` with carried context
5. Return result in standard response format

Cinema-showtimes and hunting-day-plan handlers remain as special cases. All other `fetch_domain` chips use the generic handler.

**This is the single highest-leverage item in the entire roadmap.** Every cross-domain chip becomes clickable immediately.

**Scope:** `query.ts` (`/chip` endpoint — generic handler before the 400 fallback).

**Tests:**
- Any registered domain: fetch_domain chip returns rows + viz_hint
- Unregistered domain: 404, not 400
- Existing cinema-showtimes handler still works (order of checks preserved)
- Empty result: returns empty array, not error

---

### W.2 — Context carry-forward via session memory

**What:** Wire the chip handler to read the result_stack. Chips carry `args.ref` pointing to a handle ID. The session already stores the result_stack in Redis. The wiring is missing.

1. Read `args.ref`
2. Look up the handle in `getQueryContext(sessionId).result_stack`
3. Extract `location`, `poly`, `date_from`, `date_to` as defaults
4. Chip's explicit args override the defaults

**The infrastructure exists.** `result_stack` is populated. `getHandleById` exists in `conversation-memory.ts`. It just isn't called from the chip handler.

**Scope:** `query.ts` (chip handler reads context), `conversation-memory.ts` (verify getHandleById or add it).

**Tests:**
- Chip with ref: handler extracts location from parent handle
- Chip without ref: falls back to session's current location
- Chip with explicit location in args: overrides parent handle
- Handle not found: falls back to session location, no error

---

### W.3 — Fix approval loop + structured logging

**What:** Two small fixes with zero risk.

**Fix 1:** Remove `domainDiscovery.approve()` — it sets status to "approved" but never calls `registerDiscoveredDomain`. The admin endpoint does this correctly. The method is dead code in production, only called in tests. Delete it, update the tests to use the admin endpoint directly.

**Fix 2:** Add structured log events to the four silent catch blocks that currently swallow errors: `conversation-memory.ts` (Redis read/write), `co-occurrence-log.ts` (pair recording), `query.ts` (classifier call, shadow adapter call). This is a prerequisite for diagnosing failures in any later phase.

**Scope:** `agent/domain-discovery.ts`, `conversation-memory.ts`, `co-occurrence-log.ts`, `query.ts`.

**Tests:**
- Mock Redis failure: structured log event emitted with `event: "redis_write_error"`
- Admin approve endpoint: domain immediately queryable after approval
- Admin approve endpoint: domain survives restart

---

### Immediate exit criteria

- [ ] Any cross-domain chip click returns data, not 400
- [ ] "Same area" is implicit — location carries from parent result to child query
- [ ] Single admin approval path, dead code removed
- [ ] Redis/classifier failures emit structured log events
- [ ] Story 1 partially works: crime → flood risk chip → flood data for Leeds (both as independent queries, context carries)
- [ ] Story 3 partially works: flood warnings → crime chip → crime data for Bristol

---

## Phase 0 — Generic Adapter Foundation

**Goal:** The generic adapter becomes feature-complete. Crime and weather are converted from hand-coded TypeScript to config rows. `loadDomains` becomes a DB query. After this phase, no domain is a special case.

**Why this comes after Immediate:** Users see working connected queries during Phase 0 development. The walking skeleton runs against the current architecture. Phase 0 is the foundational refactor that cleans up behind it — not a prerequisite for value delivery.

**This is the hardest phase.** Converting crime to config surfaces every assumption baked into the hand-coded adapter. That surface-finding is the point — it forces implicit knowledge to become explicit and reusable.

### 0.1 — Shape templates and config fields

**What:** Add to `DomainConfig` (in `packages/schemas/src/index.ts`) and to the `data_sources` Prisma model:

```ts
templateShape:        "incidents" | "places" | "forecasts" | "boundaries" | "listings" | "regulations"
temporality:          "time-series" | "static" | "realtime"
availabilitySource?:  string    // Redis key prefix for available months
recoveryPolicy:       ("date_shift" | "smaller_radius" | "all_category" | "none")[]
temporalResolution:   "availability_cache" | "calendar" | "realtime"
```

Write generic implementations in `generic-adapter.ts`:
- `availabilitySource` → clamp date range to cached available months
- `recoveryPolicy` → `recoverFromEmpty` iterates the list in order
- `temporalResolution` → `resolveTemporalRange` uses the right source

**Tests:**
- Generic adapter with `temporality: "time-series"` + `availabilitySource`: date range clamped
- Generic adapter with `recoveryPolicy: ["date_shift"]`: empty result tries previous month
- Generic adapter with `temporalResolution: "availability_cache"`: "last month" reads cache not calendar
- All three work together

---

### 0.2 — Convert crime-uk to a config row

**What:** Rewrite `domains/crime-uk/index.ts` as a config object passed to `createGenericAdapter`:

```ts
{
  name: "crime-uk",
  templateShape: "incidents",
  intents: ["crime"],
  countries: ["gb"],
  apiUrl: "https://data.police.uk/api/crimes-street",
  fieldMap: {
    "location.latitude":       "lat",
    "location.longitude":      "lon",
    "category":                "category",
    "month":                   "date",
    "location.street.name":    "location",
    "persistent_id":           "extras.persistent_id",
    "outcome_status.category": "extras.outcome_category"
  },
  temporality: "time-series",
  availabilitySource: "crime-uk",
  recoveryPolicy: ["date_shift", "all_category"],
  temporalResolution: "availability_cache",
  storeResults: true,
  vizHintRules: { defaultHint: "map", multiMonthHint: "bar" }
}
```

**This writes to `query_results`, not `crime_results`.** The dedicated table is no longer written to. Run a migration to backfill `query_results` from `crime_results`. The generic adapter handles `fetchData`, `storeResults`, and `recoverFromEmpty`.

**Scope:** `domains/crime-uk/index.ts`, `domains/generic-adapter.ts` (nested path support in fieldMap), migration.

**Tests:**
- Crime query via generic adapter returns same rows as hand-coded adapter
- Nested path fieldMap: `location.latitude` correctly extracted
- Date range clamped to available months
- Recovery: date_shift tries adjacent month on empty result
- All existing crime-uk tests pass

---

### 0.3 — Convert weather to a config row

**What:** Same process for weather. Config: `temporality: "realtime"`, `recoveryPolicy: ["none"]`, `temporalResolution: "realtime"`. Migration to backfill `query_results` from `weather_results`.

**Tests:**
- Weather query via generic adapter returns same rows
- Forecast window clamping works
- All existing weather tests pass

---

### 0.4 — Drop domain-specific tables

**What:** With crime and weather writing to `query_results`, run a final migration to drop `crime_results` and `weather_results`. Update the frontend: `MapView` and `BarChart` read `lat`/`lon` (not `latitude`/`longitude`), `DashboardView` reads from `query_results`.

**Scope:** Prisma migration, `App.tsx` (remove `CrimeResult[]` types, use generic row shapes).

**Tests:**
- No references to `crime_results` or `weather_results` in application code (grep assertion)
- MapView renders crime rows from `query_results` correctly
- Historical queries still return data after migration

---

### 0.5 — loadDomains becomes a DB query

**What:** Remove all static imports of domain adapters from `registry.ts`. `loadDomains` queries `data_sources` for enabled records and calls `createGenericAdapter` on each. Seed data (crime, weather, cinemas, etc.) inserted by a Prisma migration, not imported in code.

**Scope:** `domains/registry.ts`, new seed migration.

**Tests:**
- loadDomains with seeded DB: all built-in domains registered
- Domain disabled in DB: not registered
- No domain name appears in application code outside seed data and tests (grep assertion)

---

### 0.6 — Kill redundant systems

**What:** With Phase 0 complete, two systems are definitively superseded. Remove them explicitly rather than leaving them as dead code.

**Kill: Shadow adapter** (`agent/shadow-adapter.ts`) — never runs in production (requires `SHADOW_ADAPTER_ENABLED=true` which is never set). Its purpose (fallback search for empty results) is handled by the recovery policy config. Delete the file and its tests.

**Kill: Workflow templates** (`workflow-templates.ts`) — seed data only, no executor integration, references undefined virtual domains (`transport`, `geocoder`). Templates defined here are either superseded by chip-driven cross-domain navigation or by the connected query handler (W.1). Delete and redirect any callers to the chip system.

**Keep: Everything else.** Capability inference, QueryRouter, generic adapter, conversation memory, co-occurrence log, chip ranker.

**Tests:**
- No import of shadow-adapter anywhere in application code
- calculate_travel chip still works (it was using workflow_input_required response shape, not workflow-templates)
- All tests pass after deletion

---

### Phase 0 exit criteria

- [ ] `DomainConfig` has templateShape, temporality, availabilitySource, recoveryPolicy, temporalResolution
- [ ] Crime-uk is a config row, writes to query_results
- [ ] Weather is a config row, writes to query_results
- [ ] crime_results and weather_results tables dropped
- [ ] loadDomains has no static domain imports
- [ ] Shadow adapter deleted
- [ ] Workflow templates deleted
- [ ] All existing crime and weather tests pass against the generic adapter

---

## Phase 1 — Domain Lifecycle

**Goal:** A user query for an unknown topic triggers discovery, gets approved (auto or manual), and becomes immediately queryable — and stays queryable after server restart. With Phase 0 complete, this means: discovery produces a config row, `createGenericAdapter` makes it live.

### 1.1 — Fix the discovery pipeline prerequisites

**What:** The pipeline fails before it can propose a domain:
1. Stagehand extraction returns `{"url":"null","description":"null"}` — Zod rejects
2. Discovery triggers even when curated registry already matched
3. SERP key renewal is operational (not a code change)

**Fix:**
1. Guard in `/execute`: if curated registry matched, skip discovery entirely
2. Fix Stagehand prompt — empty results return `[]` not null-filled objects
3. Structured logging at each failure point

**Tests:**
- Curated registry match: discovery NOT triggered
- Stagehand returns empty: logs failure, sets requires_review
- SERP key missing: structured log, falls back to catalogue search

---

### 1.2 — Discovery proposes shape template

**What:** Update `proposeDomainConfig` to select the best-matching template shape alongside proposing the field map. The LLM receives the six template definitions and the sampled rows and returns both. The proposed config is validated: required canonical fields for the template must be present in the fieldMap.

**Scope:** `agent/workflows/domain-discovery-workflow.ts`, `packages/schemas/src/index.ts`.

**Tests:**
- Rows with lat/lon/date/category: proposes `incidents` template
- Rows with GeoJSON geometry: proposes `boundaries` template
- Rows with only date/value: proposes `forecasts` template
- Proposed config passes Zod validation with templateShape set

---

### 1.3 — End-to-end discovery test

**What:** Integration test using a mock HTTP server as the "discovered" API: unknown query → discovery → auto-approve → domain live → query returns results via generic adapter.

**Tests:**
- Mock gov.uk API returns incidents-shaped JSON
- Auto-approval fires (confidence >= 0.9, REST, gov.uk), domain registered
- Subsequent query routes to new adapter, rows stored in query_results with correct domain_name
- Server restart (simulated): domain still queryable

---

### Phase 1 exit criteria

- [ ] Discovery doesn't fail on known issues (curated guard, Stagehand prompt)
- [ ] Discovery proposes templateShape alongside fieldMap
- [ ] End-to-end test: unknown query → discovery → approval → queryable via generic adapter
- [ ] All three stories work with any combination of registered and freshly-discovered domains

---

## Phase 2 — Connected Queries

**Goal:** The walking skeleton (Immediate phase) made chips work. This phase makes the chip system complete: cross-domain chips are generated automatically, the follow-up systems are unified, and the frontend handles any chip action generically.

**Current state (after Immediate phase):** Generic fetch_domain handler works, context carries from parent result. What's still missing: chips to other domains are only generated if they're in `DOMAIN_CHIPS` or the domain relationship table. Follow-up systems are still split. Frontend chip handling still has hand-coded branches.

### 2.1 — Cross-domain chip generation

**What:** Add a step in `generateChips` that, for each `DomainRelationship` where `fromDomain` matches the current handle's domain, emits a `fetch_domain` chip pointing to `toDomain`. The ranker then scores it using the relationship weight.

After Phase 0, add a second mechanism: template shape affinity. An `incidents` result automatically suggests `boundaries` (flood zones) and `places` (services) without any hand-curated relationships.

**Start with relationship-based.** Add template affinity after Phase 0 confirms shapes are stable.

**Scope:** `capability-inference.ts` (generateChips), `domain-relationships.ts` (add flood/crime etc.).

**Tests:**
- Domain with relationship: cross-domain chip generated and returned
- Domain without relationship: no cross-domain chip
- Cross-domain chip suppressed if target domain not registered
- (Post Phase 0) incidents template: suggests boundaries and places automatically

---

### 2.2 — Frontend: generic chip execution

**What:** `handleChipAction` has hand-coded branches. Add a generic fallback that POSTs to `/query/chip`, reads the standardised response (established by W.1), renders via `viz_hint`, and pushes onto the UI result stack. New domains work without frontend code changes.

**Scope:** `App.tsx` (handleChipAction generic fallback, result stack in UI).

**Tests:**
- Any unhandled chip action: POSTs to /query/chip, renders result
- viz_hint "map": MapView shown (reads lat/lon)
- viz_hint "table": TableView shown
- Error: error state shown, no crash
- Previous result accessible after chip result

---

### 2.3 — Unify follow-up systems

**What:** `followups.ts` (hand-coded per-domain FollowUp[]) and `suggest-followups.ts` (capability-inferred Chip[]) run in parallel. Unify: convert hand-coded follow-ups to chip templates in domain config entries (after Phase 0, these live in the domain's config row as `domainChips`), delete `followups.ts`.

**Scope:** `capability-inference.ts` (config-driven domainChips), `followups.ts` (delete), `query.ts` (remove generateFollowUps call).

**Tests:**
- Crime single-month: "See last 6 months" chip generated from config
- Crime specific category: "All crime types" chip generated
- Weather single-month: "See next month" chip generated
- No duplicate suggestions

---

### Phase 2 exit criteria

- [ ] Cross-domain chips generated from relationship weights
- [ ] (Post Phase 0) Template affinity generates cross-domain chips without hand-curation
- [ ] Frontend handles any chip action generically
- [ ] Single follow-up system
- [ ] Story 1 fully works: crime → flood risk chip → flood results → food hygiene chip → food results, all via generic handler
- [ ] Story 2 fully works: cinemas → showtimes → weather chip → weather for same location
- [ ] Story 3 fully works: flood warnings → crime chip → crime results

---

## Phase 3 — Schema Evolution

**Goal:** When a domain's data shape changes, the schema evolves to accommodate new fields without data loss. With Phase 0 complete, `evolveSchema` applies to all domains (all data is in `query_results`).

**The combination that makes the schema learn:** `extras` JSONB as staging ground + `evolveSchema` as promotion mechanism + usage tracking as the promotion signal.

### 3.1 — Wire evolveSchema into the storage path

**What:** Call `evolveSchema` from `createGenericAdapter`'s `storeResults`. When rows contain fields not yet in `query_results`, columns are added automatically.

Guard rails: column list cached per domain (TTL 1 hour), max 20 new columns per event, all new columns nullable.

**Scope:** `domains/generic-adapter.ts`, `schema.ts` (add caching, safety cap).

**Tests:**
- New field in row: column added, value stored in column not extras
- Known field: no ALTER TABLE
- >20 new fields: first 20 added, rest in extras, warning logged
- SQL injection in field name: sanitised or rejected
- SchemaVersion record created per new column

---

### 3.2 — fieldMap drives initial column promotion

**What:** When `registerDiscoveredDomain` creates an adapter, the `fieldMap` defines which fields get real columns immediately. Other fields land in `extras`. Add `promoteFields(tableName, fields[])` to `schema.ts` — ensures listed fields exist as columns, migrating any existing `extras` values.

**Tests:**
- Registration with fieldMap: specified fields become columns
- Registration without fieldMap: all data in extras
- Promotion of extras field: existing row values migrated to column
- Promotion idempotent

---

### 3.3 — Usage-based promotion

**What:** Track which `extras` fields appear across queries in a Redis sorted set. After a field appears in >100 rows across >5 distinct queries, auto-promote it to a column. Passive — no LLM, no manual intervention.

New file `schema-promotion.ts`. `query.ts` records field usage after each query. Promotion check runs with a TTL guard (at most once per field per day).

**Tests:**
- Field in 100+ rows across 5+ queries: promoted to column
- Field below threshold: stays in extras
- Data consistency: extras value and column value identical after promotion
- Concurrent promotions: idempotent

---

### 3.4 — Template shape informs capability inference

**What:** Once fields are promoted from extras to real columns, `inferCapabilities` can detect richer capabilities. An `incidents` domain with a promoted `outcome_category` field can generate a "Filter by outcome" chip. A `boundaries` domain with `flood_risk_level` can generate "Severe only" — without domain-specific code.

Update `inferCapabilities` to check template shape and promoted columns. The shape says which fields are semantically meaningful; promoted columns confirm they exist.

**Scope:** `capability-inference.ts`, `domains/generic-adapter.ts` (pass templateShape to result handle).

**Tests:**
- incidents domain with promoted outcome_category: has_category inferred
- boundaries domain with promoted severity: filter_by chip generated
- No promoted fields: capabilities inferred from standard field names only

---

### Phase 3 exit criteria

- [ ] evolveSchema called from generic adapter storeResults
- [ ] New fields from discovered domains automatically become columns
- [ ] fieldMap from discovery drives initial column set
- [ ] Usage-based promotion tracks field frequency and promotes at threshold
- [ ] Template shape informs capability inference
- [ ] extras JSONB always preserves the full payload (no data loss)

---

## Phase 4 — Insight Layer

**Goal:** The system synthesises across results in the session result_stack, not just navigates between them. This is what separates a query tool from an intelligence tool.

**Current state:** `generateInsight` exists but only summarises a single result — a one-sentence count or trend. Cross-result comparison does not exist anywhere. The result_stack holds multiple handles but nothing reads more than one at a time.

**What "insight" means concretely:**

1. **Comparison** — "Crime in Leeds is 15% higher in flood zone areas than outside them"
2. **Temporal patterns** — "Burglaries in this area increased 40% in December vs November"
3. **Spatial correlation** — "The flood warnings are clustered near the river, where 60% of recent incidents occurred"
4. **Recommendations** — "These three areas have low crime, low flood risk, and high food hygiene scores"

None of this exists. Phase 4 builds it incrementally.

### 4.1 — Cross-result comparison

**What:** After a query that follows a chip click (i.e., the result_stack has >= 2 handles), run a comparison step. The comparison reads both handles' rows and computes:

- Spatial overlap (do the results cover the same area?)
- Common dimensions (do they share date, category, or location fields?)
- Summary statistics for each shared dimension

Return a `comparison` object alongside the result. The frontend renders it as an insight card above the chips.

Start simple: spatial overlap + count comparison. Not LLM — deterministic arithmetic.

Example output: "Your flood risk results cover 4 of the same areas as your crime results. Burglary rate in flood zones: 23/km². Outside flood zones: 14/km²."

**Scope:** New file `comparison.ts`, `query.ts` (call comparison after chip-triggered query), `App.tsx` (insight card component).

**Tests:**
- Two handles with overlapping areas: comparison returns spatial overlap count
- Two handles with no overlap: comparison returns "no overlap found"
- Handles with different dimensions: comparison skips non-shared fields
- Single handle: comparison not run

---

### 4.2 — Temporal pattern detection

**What:** For any result with `has_time_series`, detect and surface patterns:

- Direction of change (rising/falling/flat) across the date range
- Peak period (which month had the highest value)
- Anomalies (months significantly above or below the trend)

Extend `generateInsight` to call this when the result spans >= 2 months. Return structured pattern data alongside the natural language sentence.

**Tests:**
- Rising series: insight contains "increasing" or equivalent
- Single peak: insight names the peak month
- Anomaly: insight flags the outlier month
- Single month: pattern detection skipped, count-based insight used

---

### 4.3 — Natural language synthesis

**What:** When the result_stack has >= 2 results from different domains, call the LLM once with:
- The comparison output from 4.1
- The individual insights from each result
- The user's original query sequence

Return a 2-3 sentence synthesis that names the pattern, its significance, and what it suggests. This is the only LLM call in the insight layer — all computation in 4.1/4.2 is deterministic.

Example: "Crime in the Leeds area is concentrated near the river corridor, which overlaps with the highest-rated flood risk zones. Properties in LS1 and LS2 sit outside both risk areas and have food hygiene ratings of 4-5 stars."

**Tests:**
- Two related results: synthesis references both domains
- Unrelated results: synthesis notes the lack of overlap
- Single result: synthesis falls back to single-result insight

---

### 4.4 — Proactive analysis

**What:** After every query, automatically run 1-2 related analyses without the user asking. These appear as "insight cards" — collapsed by default, expandable:

- For an `incidents` result: check if there's a `boundaries` domain registered for the same area and run a quick overlap count
- For a `places` result: check `forecasts` for the same location and surface the next 3 days

This is not AI-driven — it's template-shape-driven. The `incidents` template says "check for boundaries overlap". The `places` template says "check for forecasts". The checks are fast (single aggregate query, not a full fetch) and fire in the background.

**Scope:** New file `proactive-analysis.ts`, `query.ts` (fire proactive checks after storeResults), `App.tsx` (insight card component, collapsed by default).

**Tests:**
- incidents result with boundaries domain registered: overlap count computed in background
- No related domain registered: no proactive card shown
- Proactive check fails: no user-facing error, failure logged

---

### Phase 4 exit criteria

- [ ] Two results from different domains produce a comparison insight card
- [ ] Time-series results surface trend direction and peak period
- [ ] LLM synthesis produces a 2-3 sentence cross-domain explanation
- [ ] Proactive analysis suggests related data automatically after each query
- [ ] Story 3 fully works including insight: "3 flood zones also have above-average burglary rates"
- [ ] Story 1 extended: "These 2 areas in Leeds have low crime, low flood risk, and high hygiene scores"

---

## Cross-cutting concerns

### Refinement system re-enable

Tier 2 refinement disabled: `location_shift` fires regardless of domain, corrupting dates. Fix: domain-match guard before applying refinement. Implement after Immediate phase when session context is solid.

### Frontend decomposition

`App.tsx` is ~2500 lines. Split after Phase 2 when chip handling patterns are stable and views are generic. Do not split prematurely — the patterns are still settling.

---

## Priority order (summary)

The correct order of battle, based on effort vs. impact:

| # | Item | Effort | Impact | Phase |
|---|------|--------|--------|-------|
| 1 | Generic fetch_domain chip handler | Small | Critical | Immediate W.1 |
| 2 | Context carry-forward (read result_stack) | Small | High | Immediate W.2 |
| 3 | Fix approval loop + structured logging | Tiny | Medium | Immediate W.3 |
| 4 | Shape templates + generic adapter config fields | Medium | Foundational | Phase 0.1 |
| 5 | Convert crime-uk to config row | Large | Foundational | Phase 0.2 |
| 6 | Convert weather to config row | Medium | Foundational | Phase 0.3 |
| 7 | Drop domain-specific tables | Medium | Foundational | Phase 0.4 |
| 8 | loadDomains becomes DB query | Medium | Foundational | Phase 0.5 |
| 9 | Kill shadow adapter + workflow templates | Small | Clarity | Phase 0.6 |
| 10 | Fix discovery prerequisites | Medium | High | Phase 1.1 |
| 11 | Discovery proposes templateShape | Medium | High | Phase 1.2 |
| 12 | End-to-end discovery test | Medium | Validation | Phase 1.3 |
| 13 | Cross-domain chip generation | Small | High | Phase 2.1 |
| 14 | Frontend generic chip execution | Medium | High | Phase 2.2 |
| 15 | Unify follow-up systems | Medium | Medium | Phase 2.3 |
| 16 | Wire evolveSchema | Small | High | Phase 3.1 |
| 17 | fieldMap drives column promotion | Medium | Medium | Phase 3.2 |
| 18 | Usage-based promotion | Medium | Medium | Phase 3.3 |
| 19 | Template-aware capability inference | Small | Medium | Phase 3.4 |
| 20 | Cross-result comparison | Medium | High | Phase 4.1 |
| 21 | Temporal pattern detection | Medium | Medium | Phase 4.2 |
| 22 | Natural language synthesis | Medium | High | Phase 4.3 |
| 23 | Proactive analysis | Medium | High | Phase 4.4 |

---

## Dependency graph

```
Immediate W.1 (generic chip handler)     — independent
Immediate W.2 (context carry-forward)    — independent
Immediate W.3 (approval + logging)       — independent

Phase 0.1 (templates + config fields)
  -> Phase 0.2 (crime to config)
  -> Phase 0.3 (weather to config)
     -> Phase 0.4 (drop domain tables)
        -> Phase 0.5 (loadDomains DB query)
Phase 0.6 (kill shadow adapter, workflow templates) — independent of 0.1-0.5

Phase 1.1 (fix discovery prereqs)        — independent
Phase 1.2 (discovery proposes template)  needs Phase 0.1
Phase 1.3 (e2e discovery test)           needs Phase 1.1, 1.2

Phase 2.1 (cross-domain chip gen)        — independent; template affinity needs Phase 0
Phase 2.2 (frontend generic chips)       needs Immediate W.1
Phase 2.3 (unify follow-ups)             cleaner after Phase 0

Phase 3.1 (wire evolveSchema)            needs Phase 0 (all data in query_results)
Phase 3.2 (fieldMap promotion)           needs Phase 3.1
Phase 3.3 (usage-based promotion)        needs Phase 3.2
Phase 3.4 (template-aware capabilities)  needs Phase 3.3 + Phase 0

Phase 4.1 (cross-result comparison)      needs Immediate W.2 (result_stack wired)
Phase 4.2 (temporal patterns)            — independent
Phase 4.3 (NL synthesis)                 needs Phase 4.1, 4.2
Phase 4.4 (proactive analysis)           needs Phase 0 (templateShape known), Phase 1
```
