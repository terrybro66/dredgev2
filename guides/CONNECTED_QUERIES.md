# Connected Queries — Architecture Exploration

> This document explores the proposed features for multi-turn query chaining, session
> memory, proactive follow-up suggestions, spatial reasoning tools, and cross-domain
> intelligence. It compares the architectural options available and closes with a
> recommended implementation roadmap.
>
> Revised after review by three independent senior engineers. Changes from v1 are
> marked ◆.

---

## The Problem

DREDGE currently treats every query as independent. A user can ask:

> "Where is Hail Mary showing near me?"

and get a good answer. But if they then ask:

> "What time is it on?"

the system has no idea what "it" refers to. And:

> "How do I get there?"

has no "there" to route to.

This is the **connected query problem**: meaningful conversations about data require
shared context across turns. Without it, the user must repeat themselves, remember
to include all relevant details in every query, and manually bridge the gap between
answers themselves.

The same problem appears in more complex spatial queries:

> "Which hunting zones are within two hours of Edinburgh by train, open on weekends,
> that allow deer stalking?"

This requires fetching data from multiple domains, computing travel reachability,
filtering on attributes, and ranking results — none of which is possible with a
single-domain single-step pipeline.

---

## ◆ System Boundaries

Before describing individual features, it is important to establish which system
is responsible for what. Without explicit ownership, these systems will bleed into
each other as they're built.

| System | Responsibility |
|---|---|
| Query result references | Structured state — typed entity references pointing into `query_results` |
| Mastra (when introduced) | Conversational resolution — pronoun/reference resolution via thread history |
| DomainRelationship model | Optimisation layer only — not primary routing; speeds up known patterns |
| Spatial tools | Computation — stateless, independently testable operations |
| Pipeline (`query.ts`) | Execution sequence — domain-agnostic orchestration |
| QueryRouter | Tool selection — templates → relationships → LLM fallback |

These boundaries must not blur. The DomainRelationship model in particular is an
optimisation over the LLM fallback path, not a replacement for it. Mastra handles
conversation; it does not handle structured data access.

---

## Feature 1 — Session Memory

### What it is

Persistent context that survives across queries within a session, so each query
can reference what came before.

### Architecture Options

#### Option A — No memory (current state)

Each query is fully standalone. Intent parsing starts from the raw text with no
prior context.

**Strengths**
- Simple — no infrastructure to maintain
- Stateless — trivially horizontally scalable
- No staleness issues

**Weaknesses**
- Cannot resolve "it", "there", "that one" — every follow-up must be fully
  self-contained
- User must repeat context on every query
- No basis for personalisation or preference learning

---

#### Option B — User attribute store

Stores fixed properties of the user: current location, license status, preferred
travel mode. Does not store query results.

This is what Phase 4.4 of the ideas.txt roadmap describes.

**Strengths**
- Solves "near me" permanently — location stored once
- Small, fast, easy to reason about
- No privacy concerns beyond user-provided data

**Weaknesses**
- Does not solve pronoun resolution ("it", "there")
- Does not enable reactive follow-up chains
- Essentially already available via the geocoder cache — limited new value

---

#### ◆ Option C — Query result references

Rather than extracting entities into a secondary store, the session holds typed
references that point directly into rows already stored in `query_results`. The
data is never duplicated — references resolve to the canonical stored record.

```ts
session.context = {
  userLocation: { lat: 55.861, lon: -4.251 },
  resolvedReferences: {
    "it":    { queryId: "q_123", field: "film_title",   value: "Hail Mary" },
    "there": { resultId: "qr_456", field: "venue_coords", value: { lat: 55.874, lon: -4.432 } },
  }
}
```

When a tool needs coordinates for "there", it reads the reference, retrieves the
typed value, and uses it directly. No extraction pass is required.

**Strengths**
- Self-validating — data is already in the database; references cannot drift
- Auditable — can show the user exactly what "there" resolved to and from which result
- Handles multiple domains without collision — each reference is scoped to a specific
  result row, so cinema venues and flood risk locations coexist without overwriting
- No domain-specific extraction schema to maintain
- No secondary store with its own lifecycle

**Weaknesses**
- Pronoun resolution still needs a pass to write the `resolvedReferences` map —
  which field in which row did "it" refer to?
- Requires query results to be stored; ephemeral (`storeResults: false`) domains
  cannot participate unless results are held in session temporarily
- Does not solve conversational resolution on its own

---

#### Option D — Conversational memory (Mastra)

Mastra provides built-in conversation thread storage. The LLM receives the full
message history for each turn and resolves references itself.

```
Thread:
  User:  "Where is Hail Mary on near me?"
  Agent: "Showing at Odeon Braehead (7:30pm) and Vue Glasgow (6:00pm, 8:45pm)"
  User:  "What time is it on?"           ← LLM reads back, resolves "it"
  Agent: "At Odeon Braehead: 7:30pm ..."
  User:  "How do I get there?"           ← LLM reads back, resolves "there"
```

**Strengths**
- Pronoun and reference resolution handled by the LLM — no custom code
- Natural conversation flow without explicit entity extraction
- Built-in thread management, persistence, and context window management
- Memory summarisation for long threads handled automatically

**Weaknesses**
- Stores messages (text), not structured data — coordinates, typed dates, IDs are
  not directly accessible for tool invocation without re-extraction
- Risk of extraction errors when multiple entities of the same type are in the thread
- Framework dependency with significant architectural opinions
- Adds latency and cost to every query turn
- Loss of control over execution model; debugging becomes opaque through framework
  abstractions

---

#### ◆ Option E — Hybrid: Mastra conversational memory + query result references

Use Mastra for conversational resolution and query result references for structured
tool arguments.

```
Mastra thread:             resolves "there" → "Odeon Braehead" from conversation
Query result reference:    provides { lat: 55.874, lon: -4.432 } for calculate_travel
```

The LLM identifies *which* entity was meant; the reference provides the typed value
needed to invoke the tool. Even if the LLM misreads the thread, the reference
lookup is deterministic.

**Strengths**
- Best of both: natural language resolution + reliable structured tool invocation
- References are self-validating — backed by stored data, not extracted copies
- Robust — reference lookup does not degrade with thread length

**Weaknesses**
- Two systems to maintain
- Mastra integration is non-trivial and should be deferred (see Feature 3)

### Recommendation

**Option E** for the target architecture. Implement incrementally:

1. Start with **Option B** (user location in session) — immediate value, low cost
2. Add **Option C** (query result references) — unblocks typed tool invocation without
   a secondary store or extraction schema
3. Add **Option D** (Mastra) later, only when composition complexity warrants it
   (see Feature 3 for the correct trigger)

---

## Feature 2 — Proactive Follow-up Suggestions

### What it is

After returning a result, the system surfaces 1–3 clickable suggestions for natural
next queries — pre-formed, entity-resolved, immediately executable.

```
Result: Hail Mary is showing at Odeon Braehead (7:30pm) and Vue Glasgow (6:00pm)

  [Directions to Odeon Braehead]   [All showtimes this week]   [Dismiss]
```

### ◆ Why suggestions are the primary UX model

This is not simply a convenience feature — it is the architectural hedge that
reduces the burden on every other system in this document.

When the system generates a suggestion, it holds the full result in context.
Entities are resolved *now*, not reconstructed from a session store later:

- "Directions to Odeon Braehead" already embeds the venue's coordinates
- The user clicks it → `calculate_travel` fires with concrete arguments
- No pronoun resolution, no working memory lookup, no Mastra thread traversal

If the user types "how do I get there?" instead, the system needs session memory.
If the user clicks a suggestion, it doesn't. **Most users will click.** This means
most of the time the hard follow-up resolution path is never exercised. Session
memory and Mastra become fallbacks for the minority who type free-form follow-ups,
not the primary systems they would be without suggestions.

Invest in suggestion quality before investing in memory complexity.

### Architecture Options

#### Option A — Hardcoded follow-up rules

Per-domain rules in code: cinema listings always offers "directions" and "all
showtimes", flood risk always offers "nearby properties".

**Strengths**
- Predictable — suggestions always make sense
- Fast — no LLM call required
- Easy to test

**Weaknesses**
- Cannot adapt to novel domains discovered at runtime
- Adding a new domain requires code changes — violates the zero-code domain principle
- Suggestions are generic and may not be contextually appropriate

---

#### ◆ Option B — Result shape inspection

After each query, a post-result hook inspects the schema of the returned rows and
offers tools that accept that schema as input:

- Result rows have `lat`/`lon` → offer travel tools
- Result rows have time-series `date` fields → offer trend tools
- Result rows have polygon geometry → offer overlay tools

**Strengths**
- Requires no relationship table or configuration
- Works immediately for any domain, including novel ones
- Grounded in actual tool availability — will never suggest a tool that doesn't exist
- Covers the obvious cases (venue → travel, time-series → trend) without admin work

**Weaknesses**
- Suggestions are schema-driven, not intent-driven — may miss non-obvious connections
- Cannot suggest actions that require knowledge of domain semantics (e.g. "compare
  with adjacent postcode" for crime data)

---

#### ◆ Option C — DomainRelationship model (optimisation layer)

Pre-curated relationships between domain pairs, each with a suggested action. Used
as an *optimisation* over Option B, not a replacement for it.

**Seeded manually for the highest-value flows:**
```
cinema listings + travel-time  →  "Directions to {venue}"
crime + crime                  →  "Compare with adjacent area"
flood risk + property          →  "Affected properties nearby"
```

**Grown via pattern discovery from query logs:**
When a domain pair co-occurs in user sessions more than a configurable threshold,
the system auto-proposes a relationship for admin approval. No manual discovery
required for the long tail.

**Strengths**
- Fast and predictable for known domain pairs
- Human-approved — high-value suggestions are vetted
- Pattern discovery from logs follows the same governance model as domain discovery

**Weaknesses**
- Cold-start problem — no relationships exist until seeded
- N² scaling as domain count grows (mitigated by log-driven discovery, not manual curation)
- Optimisation layer only — doesn't eliminate the need for Option B

---

#### Option D — Agent-driven suggestions (LLM)

After each result, the LLM reasons about what the user is likely to want next.

**Strengths**
- Works for any domain without configuration

**Weaknesses**
- LLM call after every query — latency and cost
- Inconsistent across similar queries
- Risk of hallucinating capabilities the system doesn't have
- Harder to test

---

### Recommendation

**Options B + C in combination.** Result shape inspection (B) fires for every
query with no configuration required. The DomainRelationship model (C) provides
higher-quality, intent-aware suggestions for known domain pairs and overrides the
schema-based suggestion where a curated entry exists. LLM agent suggestions (D)
are deferred until Mastra is integrated and only fire for novel domain pairs where
neither B nor C produces a result.

Implement B first (no dependencies), then seed C for the five most common flows.
Grow C via log-based pattern discovery rather than manual curation.

---

## ◆ Feature 3 — Simple QueryRouter (before Mastra)

### What it is

A lightweight routing class (~200 lines) that implements the three-tier tool
selection model without requiring an agent framework. Replaces ad-hoc LLM calls
in `query.ts` with an explicit, testable, replaceable router.

```ts
class QueryRouter {
  async route(query: string, context: SessionContext): Promise<Route> {
    // Tier 1: template match on intent signals
    const template = this.matchTemplate(query);
    if (template) return { type: "template", template };

    // Tier 2: relationship lookup
    const relationship = this.matchRelationship(query, context.lastDomain);
    if (relationship) return { type: "relationship", relationship };

    // Tier 3: LLM reasoning — logged for pattern discovery
    return await this.llmRoute(query, context);
  }
}
```

### Why this before Mastra

Mastra earns its cost when tool composition is complex enough that a custom routing
loop becomes hard to reason about. That threshold is not reached until there are
demonstrably 10+ tools *in production* handling real cross-domain queries.

Phase B delivers 7 tools. That is not the threshold. The QueryRouter covers the
gap: it is testable, debuggable, and can be replaced by Mastra later. The reverse
— replacing Mastra with a simpler router — is much harder.

**Tier 3 LLM calls are logged.** When a novel composition recurs, the log becomes
the training data for a new relationship entry or workflow template, closing the
loop without manual pattern hunting.

---

## Feature 4 — Mastra Integration

### What it is

Mastra is an open-source TypeScript agent framework that provides: tool registration,
an LLM execution loop with tool calling, conversation thread management, memory
persistence, and workflow support.

### Strengths

- Eliminates boilerplate for the agent execution loop
- Built-in conversation threading with automatic context window management
- LLM-agnostic — can use Claude, GPT, DeepSeek via OpenRouter
- Workflow templates map naturally onto Mastra's workflow primitives

### Weaknesses

- Framework dependency — architectural opinions may conflict with existing pipeline
- Replaces or wraps `query.ts`, which is the most carefully maintained file in the
  codebase
- Memory model is conversational (message-level), not structured — query result
  references still needed alongside it
- Debugging becomes opaque through framework abstractions
- Latency on every query turn even for single-domain queries

### ◆ The correct trigger for Mastra

Mastra should be introduced only when **all three conditions are met**:

1. ≥ 10 tools registered
2. ≥ 2 cross-domain workflows running in production with real queries
3. The QueryRouter's Tier 3 LLM fallback is firing frequently enough that the
   composition logic is no longer tractable to maintain manually

Until then, the QueryRouter handles routing and the query result reference store
handles structured invocation. At Phase E, the decision point is explicit: evaluate
whether the routing complexity warrants the framework cost.

---

## Feature 5 — Phase 3 Spatial Tools as Foundation

### What it is

A library of composable, stateless tools that perform spatial operations on data.
Each tool has a defined input schema, output schema, and no side effects.

| Tool | Input | Output |
|---|---|---|
| `calculate_reachable_area` | origin, time, mode | isochrone polygon |
| `overlay_spatial_data` | polygon A, polygon B, operation | intersection / union |
| `calculate_travel` | origin, destination | time, distance, route |
| `group_by_location` | rows, polygons | clustered rows |
| `filter_by_constraints` | rows, rules | filtered rows |
| `rank_by_preference` | rows, weights | scored rows |
| `sequence_by_geography` | rows, origin | ordered by travel sequence |

### Why these come before the agent

Cross-domain reasoning requires *verbs*, not just *nouns*. The agent can fetch
data from multiple domains (the nouns), but it cannot reason spatially about
them without tools that perform the spatial operations (the verbs). Building the
agent first and the tools second produces an agent that can describe multi-domain
data but not act on it.

### ◆ Tool validation interface (prerequisite — defined before any tool is built)

Every tool must implement a validation contract. A single tool returning nonsense
currently breaks the entire composition chain silently. Defining the interface first
means every Phase B tool is built to the contract from the start.

```ts
interface Tool<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: ZodSchema<TInput>;
  outputSchema: ZodSchema<TOutput>;
  execute(input: TInput): Promise<TOutput>;
  validateOutput(output: unknown): output is TOutput;
  fallback(input: TInput): TOutput;          // graceful degradation
  retryPolicy?: { maxAttempts: number; backoff: number };
  cacheKey(input: TInput): string | null;    // null = do not cache
}
```

`validateOutput` and `fallback` are not optional. A tool that cannot degrade
gracefully is not a safe composition primitive. `cacheKey` is required so the
router can cache outputs without knowing tool internals — tools that produce
expensive but stable results (isochrones, route polylines) declare a deterministic
key; tools whose outputs change per-call (live traffic) return `null`.

### ◆ Spatial tool output caching

Spatial tool outputs are expensive and stable. An isochrone for "2 hours from
Edinburgh by train" does not change between queries — the rail network is the same
today as yesterday. A route polyline for a fixed origin and destination is equally
stable. Without caching, every connected query re-runs the same computation.

The `cacheKey(input)` method on the tool interface enables the router to cache
tool outputs using the same TTL-based cache already in place for query results:

| Tool | Cache TTL | Rationale |
|---|---|---|
| `calculate_reachable_area` | 24 hours | Rail/road network changes rarely |
| `calculate_travel` | 1 hour | Traffic varies; route is stable |
| `overlay_spatial_data` | indefinite | Pure computation, deterministic |
| `filter_by_constraints` | indefinite | Pure computation, deterministic |
| `rank_by_preference` | indefinite | Pure computation, deterministic |

The cache is keyed on `(tool.name, cacheKey(input))`. A cache hit skips the
external API call entirely and returns the stored result. This is particularly
important for connected queries where the same isochrone may be needed across
multiple turns (query 1: "hunting zones within 2 hours"; query 3: "route to the
nearest one").

### ◆ Progressive registration

Tools register as they are completed. The QueryRouter can use each tool the day
it passes its tests — no batch delivery at the end of Phase B.

`calculate_travel` alone enables "Directions to Odeon Braehead" suggestions the
day it ships. No reason to wait for `sequence_by_geography`.

### Strengths

- Independently testable, stateless, composable
- Each tool adds immediate standalone value even before any agent exists
- The tool interface definition becomes the registration contract for the QueryRouter
  and later Mastra — building tools first defines the contract

### Weaknesses

- Spatial APIs (isochrones, travel time) have external dependencies and costs
- Some tools (UK rail reachable area) require domain-specific knowledge

---

## Feature 6 — Cross-Domain Reasoning

### What it is

The ability to relate data from multiple domains spatially and logically to answer
composite queries:

> "Which hunting zones are reachable from Edinburgh in under 2 hours by train,
> open to day permit holders, with deer populations?"

### Architecture: Three-tier tool selection

**Tier 1 — Workflow templates**

Pre-defined sequences matched on intent signals in the parsed query:

```
"X within distance/time of Y"  →  reachable-area template
"plan a day of X"              →  itinerary template
"X and Y in the same area"     →  cross-domain overlay template
```

Fast, predictable, no LLM reasoning at selection time.

**Tier 2 — DomainRelationship model**

When two domains are identified and a relationship entry exists, the tool chain
is taken from the table. No LLM reasoning required.

**Tier 3 — QueryRouter LLM fallback**

For novel compositions, the router asks the LLM which tools to invoke. The call
is logged. Recurring patterns graduate to Tier 2 or Tier 1.

### ◆ Additional selection signal: result shape

Result shape is an equally valid routing signal alongside intent. After a query
returns results, the post-result hook checks field presence:

- `lat`/`lon` present → `calculate_travel` and `calculate_reachable_area` are applicable
- `date` series present → trend and aggregation tools are applicable
- polygon geometry present → `overlay_spatial_data` is applicable

This fires for free with no relationship table entry. The relationship model then
provides higher-quality suggestions on top.

### ◆ Geography relevance filter

Shadow adapter sources are currently filtered by string matching on source URLs.
This is brittle: "UK-wide crime statistics 2023" contains neither "Bury St Edmunds"
nor "Suffolk" but is relevant; a regional dataset titled "South East England crime"
contains "South East" but not "Bury St Edmunds."

**Better approach:** Add a `coverage` field to `DataSource` at discovery time:

```ts
coverage: {
  type: "national" | "regional" | "local" | "unknown";
  region: string | null;          // "East of England"
  locationPolygon: GeoJSON | null; // for local sources
}
```

The LLM proposes coverage during `proposeDomainConfig`. The geography relevance
filter then performs a spatial intersection (or accepts national sources without
intersection). This reuses the existing geocoder infrastructure and is more accurate
than string matching without adding per-query latency — coverage is stored once at
discovery time.

---

## ◆ Dependency Map

```
Current state
    │
    ├─ Shadow adapter fixes (A.1–A.3)      ← data quality
    ├─ DataSource.coverage field (A.3)     ← geography filter without string matching
    ├─ User location in session (A.4)      ← "near me" works permanently
    │
    ├─ Tool validation interface (B.0)     ← defined before any tool is built
    │
Phase B — Spatial Tools (progressive registration)
    │   B.1 calculate_travel              ← register immediately
    │   B.2 filter_by_constraints         ← register immediately
    │   B.3 rank_by_preference            ← register immediately
    │   B.4 calculate_reachable_area      ← depends B.1
    │   B.5 overlay_spatial_data          ← depends PostGIS
    │   B.6 group_by_location             ← depends B.5
    │   B.7 group_by_time                 ← register immediately (no external deps)
    │   B.8 UK rail reachable area        ← depends B.4
    │
Phase C — Suggestions + Routing (overlaps B from B.1)
    │   C.1 QueryRouter built first with stub tools ← routing proven before real tools
    │   C.2 Result shape → suggestions hook
    │   C.3 Seed DomainRelationship table (5 curated flows)
    │   C.4 suggest_followups post-result hook
    │   C.5 Action chips in result UI
    │   C.6 Query result references in session (Option C memory)
    │   C.7 Log-based relationship pattern discovery
    │   C.8 Spatial artifact snapshots (isochrone + route stored in createSnapshot)
    │   ✓ STRESS TEST: cinema → travel, crime → trends
    │
Phase D — Routing maturity (weeks 8–12)
    │   D.1 Workflow templates (reachable-area, itinerary, cross-domain)
    │   D.2 Composite query execution (two domains + spatial join)
    │   D.3 Relationship auto-discovery from session co-occurrence logs
    │   D.4 Session memory for license / permit status
    │   D.5 Seed hunting zones domain in curated registry
    │   D.6 Full hunting license → zones → reachable area flow
    │   ✓ STRESS TEST: multi-domain spatial
    │
Phase E — Cross-domain + Mastra decision point (weeks 11–16)
        E.0 Decision: if tools ≥ 10 AND cross-domain complexity warrants → integrate Mastra
            Otherwise: extend QueryRouter
        E.1 Hybrid memory: Mastra conversation thread + query result references
        E.2 pgvector tool chain routing (reuse existing classifier infrastructure)
        E.3 Full hunting license → zones → itinerary with travel sequencing
        ✓ STRESS TEST: full itinerary flow end-to-end
```

---

## Recommended Roadmap

### Phase A — Data quality and immediate UX (weeks 1–2)

| Item | What | Why now |
|---|---|---|
| A.1 | Shadow adapter shape validation | Stops garbage data entering query_results |
| A.2 | Shadow adapter → query_results | Consistent storage path |
| A.3 | `DataSource.coverage` field + spatial geography filter | Replaces brittle string matching |
| A.4 | User location persisted in session | Solves "near me" permanently |

---

### Phase B — Spatial tools (weeks 3–6)

**B.0 Define `Tool<TInput, TOutput>` interface with `validateOutput`, `fallback`,
and `cacheKey` before writing any tool implementation.** This is a prerequisite,
not a deliverable. The `cacheKey` method must be implemented for every tool so the
router can cache expensive spatial outputs (isochrones, route polylines) without
knowing tool internals.

Each tool registers immediately on completion. The QueryRouter can use it the same day.

| Item | What | Dependency |
|---|---|---|
| B.1 | `calculate_travel` (road + transit) | Google Maps / TfL API |
| B.2 | `filter_by_constraints` | None |
| B.3 | `rank_by_preference` | None |
| B.4 | `calculate_reachable_area` (isochrone) | B.1 |
| B.5 | `overlay_spatial_data` | PostGIS extension |
| B.6 | `group_by_location` | B.5 |
| B.7 | `group_by_time` — aggregate rows with `date` fields by month/week, return time-series array | None |
| B.8 | UK rail reachable area | B.4 + rail API |

---

### Phase C — Suggestions + routing (weeks 4–8, overlaps B from B.1)

Suggestions are the primary UX investment. Begin with the QueryRouter (C.1) with
stub tools so routing logic is proven before real tools exist, then layer real tools
in as Phase B delivers them.

| Item | What | Dependency |
|---|---|---|
| C.1 | QueryRouter — Tier 1 templates + Tier 2 relationship lookup + Tier 3 LLM (stub tools initially) | None |
| C.2 | Result shape → compatible tool suggestions hook | B.1 |
| C.3 | Seed DomainRelationship table (5 flows: cinema→travel, crime→trend, etc.) | C.1 |
| C.4 | `suggest_followups` post-result hook wired to C.2 + C.3 | C.2, C.3 |
| C.5 | Action chips in result UI | C.4 |
| C.6 | Query result references in session (replaces extraction-based working memory) | C.4 |
| C.7 | Log-based relationship pattern discovery (Tier 3 calls logged → promoted) | C.1 |
| C.8 | Spatial artifact snapshots — extend `createSnapshot` to include isochrone polygons and route polylines | B.4 |

**Phase C acceptance criteria (stress tests):**
- [ ] **Cinema → travel**: user queries cinema listings, clicks "Directions to [Venue]" suggestion, `calculate_travel` fires with resolved coordinates, travel result returned
- [ ] **Crime → trends**: user queries crime in an area, clicks "Show trend over 6 months" suggestion, `group_by_time` fires, bar chart rendered with monthly breakdown

---

### Phase D — Routing maturity (weeks 8–12)

No Mastra in this phase. The QueryRouter handles composition. Workflow templates
are added here. The hunting zones domain must be seeded in the curated registry
before D.5 can be tested.

| Item | What | Dependency |
|---|---|---|
| D.1 | Workflow templates: reachable-area, itinerary, cross-domain overlay | C.1, B.5 |
| D.2 | Composite query execution (two domains + spatial join) | D.1, B.5 |
| D.3 | Relationship auto-discovery from session co-occurrence logs | C.7 |
| D.4 | Session memory for license / permit status (user attribute store extension) | C.6 |
| D.5 | Seed hunting zones domain in curated registry | None |
| D.6 | Full hunting license → zones → reachable area flow | D.2, D.4, D.5 |

**Phase D acceptance criteria (stress test):**
- [ ] **Multi-domain spatial**: user queries "hunting zones within 2 hours of Edinburgh by train", system fetches hunting zones domain, computes isochrone via `calculate_reachable_area`, intersects via `overlay_spatial_data`, returns ranked filtered results — all in a single query execution

---

### Phase E — Cross-domain + Mastra decision point (weeks 11–16, overlaps D)

| Item | What | Dependency |
|---|---|---|
| E.0 | **Decision point**: if ≥ 10 tools in production AND QueryRouter Tier 3 is complex → integrate Mastra; otherwise extend router | Phase D complete |
| E.1 | Hybrid memory: Mastra conversation thread + query result references | E.0 (if Mastra chosen) |
| E.2 | pgvector tool chain routing — embed successful patterns, route by similarity | Phase D, existing classifier |
| E.3 | Full hunting license → zones → itinerary with travel sequencing | D.6, B.8 |

**Phase E acceptance criteria (stress test):**
- [ ] **Full itinerary flow**: user queries hunting zones with travel constraint, selects a zone, asks "plan a day there", system sequences travel + activity timing into a complete itinerary with no manual bridging between steps

---

## Items Deferred

| Item | Reason for deferral |
|---|---|
| Video generator (Remotion) | Not connected to spatial data reasoning |
| Audio generator (Magenta) | Not connected to spatial data reasoning |
| 3D scene generator (Three.js) | Not connected to spatial data reasoning |
| Autonomous tool discovery | Premature — tool library needs to stabilise first |
| Feedback collection loop | Valuable eventually, not blocking anything now |

The itinerary generator from ideas.txt Phase 2.5 is **not** deferred — it is a
workflow template in Phase D, which is the correct home for it.

---

## Summary

The connected query problem has two separable parts: **conversational resolution**
(what does "it" mean?) and **structured invocation** (what coordinates do I pass
to the travel API?). These require different solutions and should not be conflated.

**Proactive suggestions are the primary investment.** When the system surfaces
"Directions to Odeon Braehead" as a clickable action, the coordinates are already
embedded. The user clicks, the tool fires, no session lookup required. Most users
will click. The hard follow-up resolution path — session memory, Mastra thread
traversal — exists for the minority who type free-form follow-ups. Design for the
majority first.

**Query result references replace working memory extraction.** Instead of copying
entities into a secondary store, the session holds typed references pointing into
`query_results`. The data is already there. References are self-validating,
auditable, and handle multiple concurrent domains without collision.

**Build a simple QueryRouter before Mastra.** Three-tier routing — templates →
relationships → LLM fallback — can be expressed in ~200 lines of testable code.
Mastra is warranted only when ≥ 10 tools are in production and the composition
logic becomes genuinely intractable. That threshold is a decision point at Phase E,
not a commitment made now.

**Define tool validation before any tool is built.** Every spatial tool must
implement `validateOutput` and `fallback`. A tool that cannot degrade gracefully
is not a safe composition primitive. The interface is a prerequisite for Phase B,
not a retrofit.

**The spatial tool library is not optional infrastructure.** It is the vocabulary
the agent speaks. Cross-domain reasoning without spatial tools produces a system
that can describe data relationships but not act on them.

The recommended sequence — data quality → spatial tools (progressive) →
suggestions + routing → routing maturity → cross-domain — delivers standalone user
value at every phase. No phase is purely foundational.
