# DREDGE Roadmap v2

Status as of April 2026. Strategy revised: crime is the primary polished domain. The goal is one end-to-end excellent query cycle that serves as a template for all others. Phases A–D are the crime track. Everything else is in the backlog.

---

## Phase A — Crime foundation

Fixes that make crime queries reliable before any polish work starts. All three are already written in the `interesting-grothendieck` worktree and need merging.

---

### A1 — Merge F3, F4, F5

**What it is:**

- **F3** — Availability cache reads from Redis on miss. If the server restarts and Redis has the data but the in-memory cache is cold, crime queries fall open (requesting all months including future ones). F3 reads Redis before treating the cache as empty.
- **F4** — Structured logging on silent catch blocks in `query.ts`. Several error paths swallow exceptions with no log output, making failures invisible.
- **F5** — `normalizePlan` called before cache hash computation. Currently the hash is computed on the raw plan, then the plan is normalised. This means `"crime statistics"` and `"all-crime"` produce different cache hashes even though they resolve to the same query.

**Tests to write:**
- F3: Redis-cold/in-memory-warm miss — assert cache reads from Redis and returns correct months
- F3: Full cold miss — assert `getLatestMonth` returns null and fetch falls open
- F4: Trigger a known error path — assert structured log event emitted (not swallowed)
- F5: Query with `category: "crime statistics"` and `category: "all-crime"` — assert identical cache hashes

---

### A2 — Conversation memory: structured logging on Redis failures

**What it is:**
All Redis operations in `conversation-memory.ts` are wrapped in try-catch blocks that return null silently. When Redis is down or slow, crime queries degrade with no indication of why. Adding a structured log event to each catch block makes failures visible without changing behaviour.

Also: the size limit check (line 145) logs a warning but does not reject oversized writes — data is silently dropped. This should be a logged error, not a silent truncation.

**Tests to write:**
- Mock Redis failure on session read — assert structured log event emitted with `event: "redis_read_error"`
- Mock Redis failure on session write — assert structured log event emitted with `event: "redis_write_error"`
- Oversized payload — assert log event emitted with `event: "session_payload_too_large"` before truncation

---

## Phase B — Crime polish

Makes crime the best query experience in the app. Each item has a clear spec so it becomes a template for other domains.

---

### B1 — Insight sentence

**What it is:**
After crime results are returned, generate a one-sentence natural language summary above the table/map. Example: "Burglary in Leeds fell 8% between January and March 2025." The LLM is already in the pipeline — this adds a summarisation step after rows are stored.

The sentence should:
- Name the category and location
- State the direction of change if time series spans ≥2 months
- State the count if only one month
- Be suppressed if rows_inserted is 0

**Tests to write:**
- Multi-month result — assert summary contains direction word ("fell", "rose", "unchanged")
- Single-month result — assert summary contains count
- Zero rows — assert no summary generated (null or omitted)
- Summary displayed above results in UI — assert element present in rendered output

---

### B2 — Data freshness and source attribution

**What it is:**
Two pieces of metadata displayed below every crime result:
- "Last updated: March 2025" — derived from the latest `date` value in the returned rows
- "Source: data.police.uk" — static per domain, defined in the adapter config

This sets a standard that every other domain will follow. Add a `sourceLabel` field to `DomainAdapter` config. Crime adapter sets `sourceLabel: "data.police.uk"`.

**Tests to write:**
- `sourceLabel` present on crime adapter config — assert value is `"data.police.uk"`
- Freshness date — assert derived from max `date` in result rows, formatted as "Month YYYY"
- UI — assert both attribution and freshness elements rendered when rows present
- Zero rows — assert neither element rendered

---

### B3 — Graceful empty state

**What it is:**
When a crime query returns 0 rows, the app currently shows a blank panel with no explanation. Three distinct empty states are needed:

1. **No data for area** — police force doesn't cover the queried location
2. **Date out of range** — requested month is before 2010 or beyond availability
3. **Category not available** — valid category but no incidents in that period

Each state should show a short message and, where possible, a suggestion ("Try a different date range" / "Try a nearby city").

**Tests to write:**
- Empty result for unknown area — assert message contains "no data available for this area"
- Empty result for out-of-range date — assert message references date range
- Empty result for valid category/location — assert message suggests broadening search
- UI — assert empty state renders instead of blank panel

---

### B4 — Suppress transport chip

**What it is:**
Capability inference generates a "Show nearby transport" chip whenever result rows have coordinates. This chip leads nowhere — the transport adapter does not exist. For crime results (which always have coordinates), this chip always appears and always fails.

Fix: suppress the transport chip in capability inference until a transport adapter exists. The chip generator should check the domain registry before emitting a chip for a domain that isn't registered.

**Tests to write:**
- Crime result with coordinates — assert transport chip NOT generated
- Capability inference with transport adapter registered — assert transport chip IS generated
- Other chips (category, time series) — assert unaffected

---

## Phase C — Refinement re-enable

**What it is:**
The Tier 2 refinement system allows follow-up queries to narrow a previous result — "show me crime in Manchester" → "now show me vehicle crime" — without retyping the location. Currently disabled because the `location_shift` pattern fires on any query containing "in [Place]" regardless of domain, overwriting the new query's dates with the previous active plan's dates.

The fix: check that the new query's domain matches `active_plan` before applying any refinement. If the user switches domain, clear the active plan and treat the query as fresh. This is the only item that requires restructuring the pipeline — semantic classification must run before the refinement check.

For crime specifically, this enables the most natural follow-up pattern: drilling into a category after seeing the overview.

**Tests to write:**
- Same-domain category shift: "crime in Manchester" → "vehicle crime in Manchester" — assert category updated, location/dates preserved
- Same-domain location shift: "crime in Manchester" → "crime in Leeds" — assert location updated, dates preserved
- Cross-domain query: "crime in Manchester" → "weather in Manchester" — assert active_plan cleared, new query treated as fresh
- Location shift with date: "crime in Manchester" → "crime in Leeds last month" — assert both updated
- Regression: "flood risk in York" after "crime in Manchester" — assert flood risk query is fresh (no date corruption)

---

## Phase D — Temporal intent field

**What it is:**
The LLM currently outputs `date_from`/`date_to` in YYYY-MM format for every domain. For crime this is wrong in two ways:
- The LLM guesses a month rather than asking the availability cache what the latest month is
- The user saying "last month's crime" should clamp to what's actually available, not what the LLM thinks "last month" means

The fix is to replace `date_from`/`date_to` with a single free-text `temporal` field (`"unspecified"`, `"last month"`, `"last 3 months"`, `"january 2026"`). The crime adapter implements `resolveTemporalRange(temporal)` which reads the availability cache and returns the correct date range.

This is the largest change on the crime track (~20 files). Do after Phases A–C are stable.

**Scope when actioned:**
- `packages/schemas/src/index.ts` — add `temporal: string`, keep `date_from`/`date_to` as resolved values
- `apps/orchestrator/src/intent.ts` — rewrite system prompt, add temporal resolver
- `apps/orchestrator/src/query.ts` — temporal resolution step after adapter selection
- Each domain adapter — implement `resolveTemporalRange`
- `apps/web/src/App.tsx` — update plan date display
- ~15 test files

**Tests to write:**
- Schema: `temporal` field present and valid string — assert Zod accepts it
- Crime adapter `resolveTemporalRange("unspecified")` — assert returns latest available month from availability cache
- Crime adapter `resolveTemporalRange("last month")` — assert returns previous calendar month, clamped to availability
- Crime adapter `resolveTemporalRange("last 3 months")` — assert returns 3-month range ending at latest available
- Cache hash: same temporal string + same location → same hash
- Cache hash: different temporal strings → different hashes
- Regression: crime query cycle still returns correct rows after migration

---

## Backlog — Other domains and infrastructure

Items deferred until the crime track is complete. Each will use crime as a template.

| Item | What it is | Trigger |
|------|-----------|---------|
| Hunting zones new URL | One-line `BASE_URL` change once NE CRoW endpoint confirmed | New URL found |
| Food hygiene lat/lon search | Switch FSA fetcher to `?lat=X&lng=Y` for geocoded results | Map view wanted for food |
| Stagehand storage directory | Create directory on startup so crawler doesn't ENOENT | Discovery pipeline work starts |
| SERP key renewal + Stagehand prompt fix | Renew expired key, fix null extraction prompt | Discovery pipeline work starts |
| Source promotion pipeline | pending → approved → curated status flow with admin endpoints | After discovery produces valid candidates |
| Transport adapter | Bus/rail/tube domain adapter | Data source identified |
| Flood risk polish | Apply crime template (insight, freshness, attribution, empty states) | After crime track complete |
| Cinema polish | Same | After crime track complete |
| Food hygiene polish | Same | After crime track complete |
| WorkspacesPanel URL fix | Replace hard-coded `localhost:3001` with env var | Before any production deployment |
| QueryHistoryCarousel date bug | Fix zero-padding in `buildMonths()` | Before any production deployment |

---

## Summary

| Phase | Item | Effort | Status |
|-------|------|--------|--------|
| A1 | Merge F3/F4/F5 | Small | ✅ Done |
| A2 | Conversation memory logging | Small | ✅ Done |
| B1 | Insight sentence | Medium | ✅ Done |
| B2 | Data freshness + attribution | Small | ✅ Done |
| B3 | Graceful empty state | Small | ✅ Done |
| B4 | Suppress transport chip | Trivial | ✅ Done |
| C | Refinement re-enable | Medium | ✅ Done |
| D | Temporal intent field | X-Large | After A–C stable |
