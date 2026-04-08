# Connected Queries — User Stories & Architecture Analysis

> This document analyses multi-turn query flows to determine what the
> capability-chip architecture can handle, where it needs extension, and
> what the minimal additions are to satisfy all stories.

---

## The Two Dimensions of Connected Queries

Before the stories, it is important to separate two fundamentally different
kinds of "connection":

| Type | Example | What drives it |
|---|---|---|
| **Clarification** | "what date are you going?" | The system needs more information before it can act |
| **Capability extension** | "do you want directions?" | The system has a result and is offering what can be done with it |

The current architecture handles capability extension via chips. It does not
handle clarification at all. Both stories immediately hit clarification.

---

## User Story 1 — Edinburgh Fringe

### The conversation

```
User:    "What's on at the Edinburgh Fringe?"
System:  [returns all shows — possibly thousands]

System:  "What date are you going? What category of show do you prefer?"
User:    "23rd August, comedy"

System:  [returns comedy shows on 23 Aug]
         Chip: "See shows that don't clash"
         Chip: "Map of venues"

User:    [clicks "See shows that don't clash"]
System:  [returns a non-clashing schedule]
         Chip: "Directions to first show"

User:    [clicks "Directions to first show"]
System:  [returns travel directions]
```

### Step-by-step analysis

**Step 1 — "What's on at the Edinburgh Fringe?"**

- Domain needed: events/listings (not currently in registry)
- Result: potentially thousands of shows with date, time, venue, category, lat/lon
- ResultHandle capabilities: `has_coordinates`, `has_schedule`, `has_category`
- Chips generated: "Filter by date", "Filter by category", "Map of venues"
- **Architecture verdict**: capability-chip model works — chips are pre-bound to filter operations

**Step 2 — Clarification ("what date / what category?")**

- This is NOT a chip click. The system is asking the user a question.
- The current architecture has no concept of a clarification turn.
- A chip cannot ask a question — it executes a pre-bound action.
- **Architecture gap**: needs a `ClarificationRequest` — a structured question the system poses before it can generate useful chips.

**Step 3 — "Shows that don't clash"**

- This is a constraint satisfaction problem: given a set of shows with start/end times and venues, find a subset with no temporal overlap.
- Domain needed: `filter_by_constraints` tool (Phase B.2 in roadmap)
- Input: the current result set (via ResultHandle) + user's date filter
- **Architecture verdict**: chip with pre-bound args works IF the constraint tool exists

**Step 4 — "Map of venues"**

- Result has `lat`/`lon` → `has_coordinates` capability → map viz chip
- This is straightforward capability extension
- **Architecture verdict**: works today with shape inspection

**Step 5 — "Directions to next show"**

- Requires: user's current location (session.location) + next show venue coords (from result stack)
- The "next show" is determined by the non-clashing schedule — a reference into the result of step 3
- `calculate_travel` tool receives `{origin: session.location, destination: {ref: "qr_schedule.next_venue"}}`
- **Architecture verdict**: works IF ResultHandle carries the schedule result and `calculate_travel` exists

### What this story requires

1. **ClarificationRequest** — a structured turn type where the system asks a question and waits for user input before proceeding
2. **Active filters in session** — date and category chosen in step 2 must persist so step 3 can use them
3. **Result stack** — step 5 references the output of step 3, not step 1
4. The `filter_by_constraints` and `calculate_travel` tools (Phase B)

---

## User Story 2 — Alaska Hunting License

### The conversation

```
User:    "How do I get a hunting license for Alaska?"
System:  "How old are you? Are you a visitor to Alaska?"
User:    "34, yes visitor"

System:  [returns non-resident license requirements + fee schedule]
         Chip: "Training guidance"
         Chip: "What game are you hunting?"

User:    "What game are you hunting?" → "Moose"
System:  [returns moose-specific regulations, season dates, bag limits]
         Chip: "Historical location map for moose"

User:    [clicks "Historical location map for moose"]
System:  [returns map of historical moose harvest locations]
```

### Step-by-step analysis

**Step 1 — "How do I get a hunting license for Alaska?"**

- Domain needed: regulatory/licensing (not in registry)
- The answer branches immediately on age and residency status
- This is not a data query — it is a **decision tree traversal**
- **Architecture gap**: the capability-chip model handles data results, not eligibility logic. A hunting license query has no rows to return until clarification questions are answered.

**Step 2 — Clarification (age + residency)**

- Two attributes needed before any result can be computed
- These are **user attributes**, not data — they should persist in session for the remainder of the conversation
- A chip cannot ask two questions simultaneously
- **Architecture gap**: needs `ClarificationRequest` with multi-attribute collection, and a `user_attributes` slot in session memory

**Step 3 — License requirements result**

- Once age + residency are known, the result is deterministic: non-resident over 18 → specific license type + fee
- ResultHandle capabilities: `has_regulatory_reference`, `has_training_requirement`, `has_category_filter`
- Chips: "Training guidance", "What game are you hunting?"
- "What game are you hunting?" is itself a clarification, not an action
- **Architecture gap**: chips and clarification requests are the same UI element from the user's perspective but require different handling

**Step 4 — "What game are you hunting?" → "Moose"**

- Game type is a further filter on regulations
- Stored in session as `user_attributes.game_species = "moose"`
- Result: moose-specific rules
- **Architecture verdict**: works if session stores user_attributes and the regulations adapter accepts them as filters

**Step 5 — Historical location map**

- Domain: wildlife harvest data (separate from licensing)
- This IS a capability-chip transition: result has `lat`/`lon` historical records → `has_coordinates` → map viz
- Input to chip: `{game: session.user_attributes.game_species, location: "Alaska"}`
- **Architecture verdict**: works with capability-chip model once the domain exists

### What this story requires

1. **Decision tree / regulatory adapter type** — a domain that returns structured eligibility results based on user attributes, not spatial queries
2. **User attributes in session** — age, residency, game species persisted across turns
3. **ClarificationRequest** — again, and here it must collect attributes, not just refine a query
4. **Chip/clarification unification** — "What game are you hunting?" looks like a chip but is actually a clarification

---

## Four Additional User Stories

---

### Story 3 — Purely Conversational Refinement (No New Domain)

```
User:    "Show me crime in London last month"
System:  [returns 2,847 crime results — map view]
         Chip: "See last 6 months"
         Chip: "All crime types"

User:    "Just burglaries in Hackney"
System:  [re-runs same domain query with refined category + location]
         Chip: "See last 6 months"
         Chip: "Compare to Islington"

User:    "Compare to Islington"
System:  [runs two queries, returns side-by-side bar chart]
```

**What's needed:**
- Turn 2 is free text that refines the previous query — not a chip click, not a new domain
- The QueryRouter (fallback path) must detect this is a refinement of the active query, not a new query, and merge the previous plan with the new constraints
- "Compare to Islington" is a new chip type: **comparative query** — same domain, different location, same date range, results merged for display
- **Session needs**: active query plan (not just location) so the router can merge intelligently

**Architecture verdict:** The QueryRouter fallback handles free-text refinement. The chip model handles "Compare to X" as a pre-bound comparative query. No new system needed, but session must store the active query plan.

---

### Story 4 — Real-Time + Historical Combined

```
User:    "Are there flood warnings near Bristol?"
System:  [returns current EA flood warnings — real-time, ephemeral]
         Chip: "How does this compare to last year?"
         Chip: "Show affected transport routes"

User:    [clicks "How does this compare to last year?"]
System:  [fetches historical flood data for same area + overlays on current]
         Two-panel view: current warnings vs. last year's same period

User:    [clicks "Show affected transport routes"]
System:  [fetches TfL/National Rail disruptions for Bristol area]
         Chip: "Plan a route avoiding flood zones"
```

**What's needed:**
- Turn 1 result is ephemeral (realtime EA API — not stored)
- Turn 2 chip references the ephemeral result's spatial extent (polygon) to query the historical archive
- Cross-domain: flood warnings (real-time) + flood archive (historical) + transport (real-time)
- ResultHandle must work for ephemeral results — the data isn't in `query_results` but the handle still needs to carry capabilities and geometry
- **Architecture gap**: ephemeral ResultHandles — currently session references point into `query_results` rows which ephemeral results never write

**Architecture verdict:** Requires ephemeral ResultHandle — a handle whose data lives in session memory for the duration of the conversation, not in the DB. The capability inference still works the same way.

---

### Story 5 — Eligibility + Spatial (Regulatory)

```
User:    "Can I open a food business in Manchester?"
System:  "Is this a new premises or change of use?"
User:    "New premises"

System:  [returns registration requirements: EHO inspection, food hygiene cert, etc.]
         Chip: "Find available commercial units"
         Chip: "Check planning permission zones"

User:    [clicks "Check planning permission zones"]
System:  [returns map of commercial-use zones in Manchester]
         Chip: "Show units in permitted zones"

User:    [clicks "Show units in permitted zones"]
System:  [intersects commercial units with permitted zones — spatial join]
         Chip: "Check flood risk for shortlisted units"
```

**What's needed:**
- Regulatory clarification (new vs. change of use)
- Cross-domain spatial join: planning zones (polygon) ∩ commercial units (points)
- `overlay_spatial_data` tool (Phase B.5)
- Session carries: business type, planning context, shortlisted unit coordinates
- **Architecture verdict:** Clarification + capability-chip model + spatial tools covers this entirely. No new system needed beyond what's already planned.

---

### Story 6 — Multi-Domain Spatial Chain

```
User:    "What are the best areas to cycle in Edinburgh with low crime?"
System:  [fetches cycle routes (lat/lon polylines) + crime density (heatmap)]
         Capability: has_coordinates, has_polygon, has_time_series
         Chip: "Rank routes by safety"
         Chip: "Show as map"

User:    [clicks "Rank routes by safety"]
System:  [spatial join: crime density ∩ route geometry → safety score per route]
         Ordered list of routes
         Chip: "Show weather forecast for this weekend"
         Chip: "Get directions for the safest route"

User:    [clicks "Get directions for the safest route"]
System:  [calculate_travel with route geometry as waypoints]
```

**What's needed:**
- Two domains in a single initial query (cycle routes + crime) — a composite query
- `overlay_spatial_data` to intersect crime density with route geometry
- `rank_by_preference` to score routes
- ResultHandle for the ranked list references back to original route geometries
- **Architecture verdict:** This is the Phase D "composite query" case. The capability-chip model handles it IF the QueryRouter can decompose the initial query into two parallel domain fetches. The chips then operate on the merged result.

---

## Cross-Story Architecture Analysis

### What the capability-chip model handles well

| Scenario | Coverage |
|---|---|
| Post-result capability extension | ✅ Full — shape inspection drives chips |
| Spatial operations on existing results | ✅ Full — tools receive ResultHandles |
| Domain refinement (same domain, narrower query) | ✅ QueryRouter fallback |
| Comparative queries (same domain, different location) | ✅ Pre-bound chip |
| Multi-domain composition (Phase D) | ✅ QueryRouter decomposes, chips chain |
| Ephemeral result capabilities | ⚠️ Partial — needs ephemeral ResultHandle |

### What requires extension

| Gap | Stories affected | Required addition |
|---|---|---|
| Clarification turns | 1, 2, 5 | `ClarificationRequest` — structured question the system poses |
| User attributes in session | 2, 5 | `session.user_attributes` slot (age, residency, game species, business type) |
| Active query plan in session | 3 | `session.active_plan` so free-text refinements can merge |
| Ephemeral ResultHandles | 4 | Handle type that lives in session, not DB |
| Regulatory/decision-tree adapter | 2, 5 | New adapter type that returns eligibility results not spatial rows |
| Result stack (reference prior step) | 1, 6 | `session.result_stack[]` — not just one result, last N |

### The clarification problem in detail

Stories 1 and 2 both require the system to ask questions before it can generate a result. This is qualitatively different from capability extension:

```
Capability extension:    Result → Chips (system has data, offers what to do next)
Clarification:          No result yet → Question (system needs input before it can act)
```

The chip payload spec `{label, action, args}` cannot represent a clarification — there is no action to pre-bind because the action depends on the answer.

**Three options:**

**Option A — ClarificationRequest as a first-class response type**
The system returns `{type: "clarification", questions: [{field: "date", prompt: "What date are you going?"}]}` instead of a result. The UI renders a small form. On submission the answer is stored in session and the query re-executes.

Pro: clean separation. Con: adds a new response type the frontend must handle.

**Option B — Clarification chips**
A chip that, when clicked, opens an inline input rather than executing directly. `{label: "Filter by date", action: "clarify", field: "date"}`.

Pro: same UI component. Con: blurs the chip/clarification distinction; requires frontend to handle two chip behaviours.

**Option C — Partial results + refinement chips**
Return the best result possible without clarification (all shows, all crime types), then offer refinement chips. The user never has to answer a question — they click chips to narrow.

Pro: no new architecture. Con: "all Fringe shows" is useless without date/category; some regulatory queries have no meaningful "all" result.

**Recommendation: Option A for regulatory/eligibility queries, Option C for data queries.**

The Fringe story works with Option C (return all shows + offer date/category filter chips). The hunting license story requires Option A — there is no meaningful "all licenses" result to show before knowing residency.

---

## Revised Architecture Recommendation

### What stays the same

- Capability inference from result shape (`has_coordinates`, `has_time_series`, `has_polygon`)
- Chip payload spec: `{label, action, args: {ref: "..."}}`
- QueryRouter as fallback for free text only
- DomainRelationship as ranking weight only (not routing)
- Mastra deferred

### What changes

**Session memory expands from location-only to:**

```ts
interface ConversationMemory {
  location: SessionLocation | null;        // already implemented
  active_plan: QueryPlan | null;           // for free-text refinement merging
  result_stack: ResultHandle[];            // last N results (not just one)
  user_attributes: Record<string, unknown>; // age, residency, game, business type
  active_filters: Record<string, unknown>; // date, category, etc. accumulated across turns
}
```

**ResultHandle becomes a first-class type:**

```ts
interface ResultHandle {
  id: string;                    // "qr_456"
  type: string;                  // "cinema_venue" | "crime_incident" | "flood_warning"
  capabilities: Capability[];    // ["has_coordinates", "has_schedule"]
  ephemeral: boolean;            // true = data lives in session, not DB
  data: unknown[];               // rows (ephemeral) or pointer to query_results
}
```

**New adapter type: Regulatory**

Returns a `DecisionResult` rather than spatial rows:

```ts
interface DecisionResult {
  eligibility: "eligible" | "ineligible" | "conditional";
  conditions: string[];          // "Must complete Food Hygiene Level 2"
  next_questions: ClarificationField[]; // further clarification needed
  references: string[];          // links to official guidance
}
```

Regulatory adapters answer eligibility queries. They do not go through the geocoder. They do not write to `query_results`. They use a different result renderer in the frontend.

**ClarificationRequest for regulatory domains only:**

```ts
interface ClarificationRequest {
  type: "clarification";
  questions: {
    field: string;
    prompt: string;
    options?: string[];  // for multiple choice
    input_type: "text" | "number" | "select" | "boolean";
  }[];
}
```

The frontend renders this as a small inline form. On submit, answers are stored in `session.user_attributes` and the query re-executes with those attributes injected.

**Chip ranking:**

All valid capabilities are generated, then scored:

```
score = (frequency_in_logs × 0.4)
      + (spatial_relevance × 0.3)
      + (recency_in_session × 0.2)
      + (domain_relationship_weight × 0.1)
```

Top 3 are shown. This prevents chip proliferation as domains grow.

### What is new

| Component | What it does | When needed |
|---|---|---|
| `ConversationMemory` | Extends session beyond location | Phase C |
| `ResultHandle` | Typed abstraction tools operate on | Phase C |
| `ClarificationRequest` | Structured question turn for regulatory | Phase D |
| Regulatory adapter type | Eligibility/decision-tree domains | Phase D |
| Ephemeral ResultHandle | In-session data for ephemeral results | Phase C |
| Chip ranker | Score + select top 3 from all valid | Phase C |

---

## Story-Architecture Coverage Matrix

| Story | Capability chips | QueryRouter | Session memory | ClarificationRequest | Regulatory adapter | Spatial tools |
|---|---|---|---|---|---|---|
| 1. Edinburgh Fringe | ✅ (steps 3–5) | ✅ (step 2 refinement) | ✅ active_filters | ✅ (step 2) | ❌ | ✅ travel |
| 2. Alaska Hunting | ✅ (steps 3–5) | ❌ | ✅ user_attributes | ✅ (step 2) | ✅ | ✅ map |
| 3. Crime refinement | ✅ | ✅ active_plan merge | ✅ active_plan | ❌ | ❌ | ❌ |
| 4. Flood + transport | ✅ | ❌ | ✅ ephemeral handle | ❌ | ❌ | ✅ overlay |
| 5. Food business | ✅ (steps 3–5) | ❌ | ✅ user_attributes | ✅ (step 2) | ✅ | ✅ overlay |
| 6. Cycle + crime | ✅ | ✅ decompose | ❌ | ❌ | ❌ | ✅ overlay + rank |

**Key insight:** Stories 1, 2, and 5 all require `ClarificationRequest`. This is the most common gap and the highest priority addition after capability chips and ResultHandles.

---

## Implementation Order (revised)

The Phase A/B/C order in CONNECTED_QUERIES.md remains correct. This analysis adds:

1. **C.0 (before C.1)** — Define `ConversationMemory` and `ResultHandle` types. Session expansion is a prerequisite for everything else.
2. **C.1** — QueryRouter (unchanged)
3. **C.2** — Chip ranker (score → top 3) alongside shape inspection
4. **C.6** — ResultHandle storage in session (now well-defined)
5. **D.3** — ClarificationRequest response type + frontend form renderer
6. **D.4** — Regulatory adapter type (hunting, food business, licensing)
7. **D.5** — Ephemeral ResultHandle (needed for real-time data stories)
