# DREDGE Audit: Unplanned Built Systems

Status as of April 2026. These systems were built during development but were never formally planned, documented, or fully wired into the active query pipeline. Each entry records what exists, what is wired vs dormant, and what risks are outstanding.

This document does not prescribe fixes — see `roadmap-v2.md` for prioritised work. This is a factual record of what was found.

---

## 1 — Shadow Adapter

**Files:**
- `apps/orchestrator/src/agent/shadow-adapter.ts`
- `apps/orchestrator/src/__tests__/shadow-adapter.test.ts`

**What it is:**
A last-resort fallback adapter that searches alternative sources when a normal query returns 0 rows. Evaluates candidate sources by sampling them and detecting their format.

**Wiring status: Dormant by default**
- Triggered in `query.ts` only when: rows are empty AND `SHADOW_ADAPTER_ENABLED=true` env var is set
- `SHADOW_ADAPTER_ENABLED` is not set in any environment config that ships with the repo
- In practice: never runs

**Gaps:**
- `searchAlternativeSources` and `sampleAndDetectFormat` are mocked in tests — the live implementations are not integrated with any real source index
- Geographic validation falls back silently from PostGIS polygon matching to token matching when PostGIS is unavailable — no log event
- National source hosts hard-coded at lines 95–101 (`gov.uk`, `data.police.uk`, etc.) — no configuration path

**Risk:** Low immediate risk (it's off). Risk if enabled: silent geographic fallback may produce results from wrong region.

---

## 2 — Capability Inference

**Files:**
- `apps/orchestrator/src/capability-inference.ts`

**What it is:**
Inspects the rows returned by a query and infers what the data is capable of: coordinates, time series, polygons, schedules, categories. Generates UI chips (action suggestions) based on those capabilities.

**Wiring status: Fully wired**
- Called after every successful query
- Chips fed to chip ranker, then to frontend
- Results stored in ephemeral ResultHandle via `conversation-memory.ts`

**How inference works:**
- `has_coordinates`: ≥80% of rows have valid `lat` + `lon`
- `has_time_series`: ≥2 distinct dates + at least one numeric column
- `has_polygon`: polygon geometry present
- `has_schedule`: schedule-shaped fields present
- `has_category`: ≥2 distinct values in a categorical column

**Gaps:**
- Threshold values (80%, 2 dates, etc.) are hard-coded with no rationale documented
- "Show nearby transport" chip is generated when `has_coordinates` is true, but the transport domain adapter does not exist (D2 in roadmap)

**Risk:** Medium. Transport chip appears in the UI and leads nowhere. See D2.

---

## 3 — Workflow Templates

**Files:**
- `apps/orchestrator/src/workflow-templates.ts`

**What it is:**
A system for defining multi-step query workflows — e.g. "show crime then show flood risk for the same area". Templates describe a sequence of domain queries with shared context.

**Wiring status: Seed data only — no executor**
- Templates are defined and stored
- No executor integration visible — templates are never triggered from the query pipeline
- Domain references to `transport` and `geocoder` appear at lines 32, 59, 149 — neither is a real domain in the registry
- Cross-domain overlay template references undefined domains at lines 249–250

**Gaps:**
- Undefined virtual domains (`transport`, `geocoder`) will cause runtime errors if an executor is ever wired
- No domain validation at template definition time — invalid templates are accepted silently

**Risk:** Low (nothing calls it). Risk if wired: undefined domain references will throw.

---

## 4 — Conversation Memory

**Files:**
- `apps/orchestrator/src/conversation-memory.ts`

**What it is:**
Stores session state and query history in Redis. Tracks the active plan, result handles, chips, and a per-user profile built from query patterns.

**Wiring status: Fully wired**
- Called on every query to read and write session state
- TTLs: session 24h, profile 30d, max ephemeral rows 100

**Silent error risks:**
- All Redis operations wrapped in try-catch returning `null` on error — failures are invisible in logs
- Size limit check (line 145) logs a warning but does NOT reject an oversized write — data is silently dropped
- Pushes result handle with `data: null` strip to context (lines 360–362) — error swallowed silently

**Gaps:**
- No structured log event on Redis write failure — if Redis goes down, queries degrade silently
- Oversized session data silently truncated with no user feedback
- Profile building is fully automatic with no way to reset or inspect a user's profile

**Risk:** Medium. Redis outages look like normal query failures. Oversized payloads silently drop data.

---

## 5 — Cinema Showtimes

**Files:**
- `apps/orchestrator/src/domains/cinemas-gb/showtimes.ts`
- `apps/orchestrator/src/__tests__/cinema-showtimes.test.ts`

**What it is:**
A second stage for cinema queries — after venues are returned (Track A), a follow-up chip ("show showtimes") triggers a SerpAPI search to find screening times for a specific cinema.

**Wiring status: Partially wired**
- Chip generated by `capability-inference.ts` when domain is `cinemas-gb`
- Endpoint exists and is unit tested
- SerpAPI integration is mocked in all tests — live integration never tested

**Gaps:**
- If `resolveUrlForQuery` returns null, falls back to empty string (line 77) — produces a malformed SerpAPI call with no error
- Live SerpAPI key required — not validated on startup
- No fallback when SerpAPI returns 0 results

**Risk:** Medium. Feature appears available in the UI but will silently fail if SerpAPI key is absent or expired.

---

## 6 — Hunting Licence GB

**Files:**
- `apps/orchestrator/src/domains/hunting-licence-gb/index.ts`
- `apps/orchestrator/src/__tests__/hunting-licence.test.ts` (unit tested)

**What it is:**
A regulatory adapter that answers eligibility questions about hunting licences — age gating, species-specific rules, season dates. Returns structured eligibility results rather than map/table data.

**Wiring status: Unit tested but not in query pipeline**
- Tests pass (age gating, species conditions)
- Adapter must be registered via `registerRegulatoryAdapter("hunting licence eligibility")` — no evidence this is called on server startup
- No intent routing — no CATEGORY_TO_INTENT mapping leads to this adapter
- No integration test linking intent resolver → adapter

**Gaps:**
- No startup registration means the adapter is unreachable from any query
- No test for the path from natural language query to adapter invocation

**Risk:** Low immediate risk (silently unreachable). Risk if registration is added without testing: eligibility logic edge cases untested in integration.

---

## 7 — Domain Relationships

**Files:**
- `apps/orchestrator/src/domain-relationships.ts`

**What it is:**
A manually curated set of relationships between domains with confidence weights. Used by the chip ranker to surface cross-domain follow-up suggestions — e.g. after a flood risk query, suggest transport.

**Wiring status: Data only — ranker integration unclear**
- Five relationships defined (e.g. `cinema → transport: 0.8`, `flood → transport: 0.9`)
- Fed to chip ranker but ranker implementation not visible
- Comment at line 12: "C.12 will eventually auto-promote from co-occurrence" — not implemented

**Gaps:**
- Relationships are static and manually maintained — no auto-discovery
- Ranker integration path not confirmed
- Transport chip points to a non-existent domain (D2)

**Risk:** Low. Data is inert without a working ranker. Medium if ranker is wired: transport chips still lead nowhere until D2 is done.

---

## 8 — Co-occurrence Log

**Files:**
- `apps/orchestrator/src/co-occurrence-log.ts`

**What it is:**
Logs which domain pairs appear together in a session using a Redis sorted set. Intended to eventually feed the domain relationships system (C.12) and auto-discover which domains users query together.

**Wiring status: Write side wired — read side not confirmed**
- Records domain pairs via Redis `zincrby` (line 44) — called from session tracking
- `relationship-discovery.ts` reads the counts (line 61) but integration to chip ranker not confirmed

**Gaps:**
- Try-catch at lines 49–52 swallows pipeline errors silently — Redis failures invisible
- Consumer (relationship-discovery → chip ranker) integration not verified
- No mechanism to reset or inspect co-occurrence data

**Risk:** Low. Data is being collected correctly. Risk if consumer is wired without testing: stale or corrupt counts could surface misleading chip suggestions.

---

## 9 — WorkspacesPanel

**Files:**
- `apps/web/src/components/WorkspacesPanel.tsx`

**What it is:**
A frontend panel for managing named workspaces — saved query contexts a user can return to.

**Wiring status: Partially wired**
- Component exists and renders
- Fetches from API on mount

**Gaps:**
- API URL hard-coded as `http://localhost:3001` — will fail in any non-local environment
- No environment variable read
- Error handling: try-catch sets `loading=false` but displays nothing to the user on failure — shows blank panel with no feedback
- No retry, no fallback state

**Risk:** High in any deployed environment. Will silently show a blank panel for all non-localhost users.

---

## 10 — QueryHistoryCarousel

**Files:**
- `apps/web/src/components/QueryHistoryCarousel.tsx`

**What it is:**
A frontend carousel showing the user's recent queries, grouped by month, for quick re-execution.

**Wiring status: Partially wired**
- Component exists and renders
- Reads from Zustand store (`useDredgeStore()`)

**Gaps:**
- API URL hard-coded as `http://localhost:3001` — same issue as WorkspacesPanel
- `buildMonths()` date calculation (lines 47–59): parses YYYY-MM strings without zero-padding. `"2024-1"` will fail to parse correctly — off-by-one risk for January and single-digit months
- `useDredgeStore()` called with no null check — if store is undefined (SSR or test context), component throws
- No error handling on the store read

**Risk:** Medium. Date bug affects display for months 1–9. Store assumption will throw in contexts without the Zustand provider.

---

## Summary Table

| # | System | Wired? | Immediate Risk |
|---|--------|--------|---------------|
| 1 | Shadow Adapter | Dormant (env flag) | Low |
| 2 | Capability Inference | Fully wired | Medium (transport chip) |
| 3 | Workflow Templates | Seed data only | Low |
| 4 | Conversation Memory | Fully wired | Medium (silent Redis failures) |
| 5 | Cinema Showtimes | Partially wired | Medium (SerpAPI untested) |
| 6 | Hunting Licence GB | Unit tested only | Low |
| 7 | Domain Relationships | Data only | Low |
| 8 | Co-occurrence Log | Write side only | Low |
| 9 | WorkspacesPanel | Partially wired | **High** (hard-coded URL) |
| 10 | QueryHistoryCarousel | Partially wired | Medium (date bug, store) |

**Highest priority items from this audit:**
1. WorkspacesPanel hard-coded URL — breaks in any deployed environment
2. Conversation Memory silent failures — Redis outages look like query failures
3. Transport chip leads nowhere — capability inference generates it, D2 does not exist yet
4. Cinema Showtimes SerpAPI — appears working in UI, silently fails without a live key
