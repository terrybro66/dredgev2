# Connected Queries — Architecture Exploration

> This document explores the proposed features for multi-turn query chaining, session
> memory, proactive follow-up suggestions, spatial reasoning tools, and cross-domain
> intelligence. It compares the architectural options available and closes with a
> recommended implementation roadmap.
>
> Revised after review by three independent senior engineers. Changes from v1 are
> marked ◆.
>
> **v3 revision:** Updated after user story analysis. Changes marked ◆◆. See
> `USER_STORIES.md` for the story-by-story rationale behind these changes. Key
> additions: `ClarificationRequest` response type, `ResultHandle` abstraction,
> `ConversationMemory` expansion, regulatory adapter type, and clarification that
> `DomainRelationship` is a ranking weight only — it does not drive chip generation.

---

## ◆◆ The Two Modes of Connection

Multi-turn query flows fall into two distinct modes. They look similar in the UI
but require fundamentally different handling:

| Mode | What it means | Example |
|---|---|---|
| **Capability extension** | System has a result and offers what can be done with it | "Show affected transport routes" after a flood result |
| **Clarification** | System needs user input before it can produce a result | "What date are you going?" before returning Fringe shows |

A chip pre-binds to an action. A chip cannot ask a question — it executes. These
two modes must remain architecturally separate.

The **capability-chip model** (Features 2 and 5) handles capability extension.
**`ClarificationRequest`** (Feature 6, below) handles clarification. The system
must not conflate them.

**When to clarify vs. when to return partial results:**

| Query type | Approach |
|---|---|
| Data query (shows, crime, flood) | Return best result without clarification. Offer filter/refinement chips. The "all results" set is meaningful. |
| Regulatory/eligibility query (hunting licence, food business) | Return `ClarificationRequest` first. There is no meaningful "all" result before eligibility attributes are known. |

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

#### ◆ Option C — Query result references (revised: ResultHandle + ConversationMemory)

Rather than extracting entities into a secondary store, the session holds typed
`ResultHandle`s — lightweight abstractions that either point into `query_results`
rows (persistent) or carry data directly in session (ephemeral). The full data
is never duplicated in the persistent case.

**◆◆ ResultHandle** (formalised in v3):

```ts
interface ResultHandle {
  id: string;                    // "qr_456" or "ephemeral_abc"
  type: string;                  // "cinema_venue" | "crime_incident" | "flood_warning"
  capabilities: Capability[];    // what operations are valid on this result
  ephemeral: boolean;            // true = data lives in session, not query_results
  data: unknown[];               // rows (if ephemeral) or pointer to query_results
}
```

Capabilities are inferred from result shape at query time, not declared by the
domain author. Rules:

| Capability | Condition |
|---|---|
| `has_coordinates` | ≥ 80% of rows have non-null `lat` + `lon` |
| `has_time_series` | rows span ≥ 2 distinct dates with a `value` or count field |
| `has_polygon` | result includes GeoJSON polygon geometry |
| `has_schedule` | rows have `start_time` and `end_time` in extras |
| `has_category` | rows have non-null `category` with ≥ 2 distinct values |
| `has_regulatory_reference` | result type is `DecisionResult` from a regulatory adapter |

**◆◆ ConversationMemory** (formalised in v3):

The session expands from location-only to a full conversation context:

```ts
interface ConversationMemory {
  location: SessionLocation | null;          // already implemented (Phase A)
  active_plan: QueryPlan | null;             // for free-text refinement merging
  result_stack: ResultHandle[];              // last N results — not just one
  user_attributes: Record<string, unknown>;  // age, residency, game species, etc.
  active_filters: Record<string, unknown>;   // date, category, etc. accumulated
}
```

`result_stack` is needed because Story 1 (Edinburgh Fringe) shows that step 5
("Directions to first show") references step 3's output ("Non-clashing schedule"),
not step 1's ("All shows"). A single `active_result` slot loses this chain.

`user_attributes` and `active_filters` are intentionally separate:
- `user_attributes` — facts about the user (age, residency) that span the whole session
- `active_filters` — constraints on the current data query (date, category) that
  may be replaced per turn

**Refinement merge semantics** — `active_plan` is used when a free-text follow-up
narrows rather than replaces the current query. Merge is pattern-matched first; the
LLM is a last resort (same three-tier principle as the QueryRouter):

```ts
interface RefinementMerge {
  type: "date_shift" | "location_shift" | "category_filter" | "aggregation_change";
  apply(plan: QueryPlan, refinement: string): QueryPlan | null;
  // null = cannot merge → treat as new query, clear active_plan
}

const REFINEMENT_PATTERNS: Array<{ re: RegExp; type: RefinementMerge["type"] }> = [
  { re: /\b(last|past|previous)\s+(\d+\s+)?(year|month|week)/i, type: "date_shift" },
  { re: /\b(in|near|around)\s+\w+/i,                            type: "location_shift" },
  { re: /\bjust\s+\w+/i,                                        type: "category_filter" },
  { re: /\bby\s+(month|week|day|year)/i,                        type: "aggregation_change" },
];
```

Pattern match against the follow-up text. If a pattern matches, apply the transform
to `active_plan` and re-execute. If no pattern matches, ask the LLM to classify the
refinement type. If the LLM returns an unrecognised type or `null`, treat as a new
query: clear `active_plan`, run fresh discovery.

**active_filters replacement semantics** — filters do not blindly accumulate; they
follow per-type rules:

| Filter type | Behaviour on new value |
|---|---|
| `category` | Replaces — "just drama" replaces "comedy" |
| `date` / `date_range` | Replaces — "last year" replaces "last month" |
| `location` | Replaces — "in Hackney" replaces "in Camden" |
| `exclude` / negation | Composes (AND) — "not burglary" adds to existing exclusions |

This prevents contradictory filters accumulating silently (category=comedy AND
category=drama) while preserving negative filter stacks.

**Strengths**
- Self-validating — persistent handles backed by stored data, cannot drift
- Auditable — the user can see exactly what a chip will operate on
- Handles multiple domains without collision — each handle is scoped to one result
- Ephemeral handles cover realtime/live sources (flood warnings, live traffic)
- No domain-specific extraction schema to maintain

**Weaknesses**
- Pronoun resolution ("there", "it") still needs a pass to map pronouns to handles
- Ephemeral handles live only for the session duration — appropriate for live data

**Ephemeral ResultHandle lifecycle:**

Ephemeral handles (`ephemeral: true`) follow these rules:

- **Row cap**: maximum 100 rows. If a source returns more, the adapter must write
  to `query_results` and return `ephemeral: false` — truncation is never acceptable.

- **Storage**: Redis key `session:handle:{sessionId}:{handleId}`, TTL 3600s (1 hour,
  shorter than the 24h location TTL). Redis — not in-memory — ensures handles survive
  process restarts within their window and are safe under horizontal scaling.

- **Eviction**: when `result_stack` exceeds N=5, the oldest handle is dropped from
  the stack and its Redis key is deleted immediately (no wait for TTL).

- **Post-restart**: ephemeral data does not survive beyond Redis TTL. A chip
  referencing a missing handle gets a `stale_reference` error, not a 500.

**Stale chip reference handling:**

Before executing any chip, the orchestrator validates that `args.ref` resolves to a
live Redis key and exists in `session.result_stack`. If either check fails:

```ts
{ type: "error", error: "stale_reference",
  message: "This option is no longer available — the result it referred to has expired." }
```

Frontend renders a non-alarming inline notice. This applies equally to persistent
handles that have been manually deleted and ephemeral handles past their TTL.

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

#### ◆ Option C — DomainRelationship model (ranking weight only)

Pre-curated relationships between domain pairs. Used as a **ranking weight** over
the chips that Option B (shape inspection) already generated — not as the mechanism
that generates chips.

**◆◆ Critical clarification (v3):** The original framing implied that
`DomainRelationship` entries drive which chips appear. This was incorrect. A chip
appears because the result `has_coordinates` (inferred from shape). The
`DomainRelationship` entry for `{cinema, transport}` boosts the travel chip's score
over other valid chips. If the relationship entry didn't exist, the chip would still
appear — it would just rank lower. **Capabilities drive chip generation.
Relationships adjust chip ranking.**

**Chip scoring formula:**
```
score = (frequency_in_session_history × 0.4)
      + (spatial_relevance × 0.3)
      + (recency_in_session × 0.2)
      + (domain_relationship_weight × 0.1)
```

Top 3 chips are shown. This prevents proliferation as domain count grows.

**Seeded manually for the highest-value flows:**
```
cinema listings + transport  →  weight 0.9  ("Directions" ranks above other travel chips)
flood risk + transport       →  weight 0.8  ("Affected routes" boosted)
crime + crime                →  weight 0.7  ("Compare with adjacent area" boosted)
```

**Grown via pattern discovery from query logs:**
When a domain pair co-occurs in user sessions above a configurable threshold, the
system auto-proposes a relationship entry for admin approval.

**Strengths**
- Fast and predictable for known domain pairs
- Human-approved — high-value ranking adjustments are vetted
- Cold-start is not fatal — the system degrades gracefully to shape-only ranking

**Weaknesses**
- Cold-start produces generic ranking for novel domain pairs (shape-only)
- N² scaling as domain count grows (mitigated by log-driven discovery, not manual curation)
- Ranking layer only — does not add chip actions that shape inspection can't generate

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

**Options B + C in combination.** Result shape inspection (B) drives chip
generation for every query with no configuration required. The DomainRelationship
model (C) adjusts the ranking of generated chips for known domain pairs so the most
relevant chip surfaces at position 1. LLM agent suggestions (D) are deferred until
Mastra is integrated.

Implement B first (no dependencies), then seed C for the five most common flows.
Grow C via log-based pattern discovery rather than manual curation.

**◆◆ Summary of corrected framing (v3):**
- Option B generates chips (based on result capabilities)
- Option C ranks chips (based on domain relationship weights)
- LLM (Option D) is a fallback for novel compositions only

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

## ◆◆ Feature 6 — ClarificationRequest and Regulatory Adapter

*Added in v3 after user story analysis. Stories 1, 2, and 5 all require the system
to ask questions before or after a result. This is the most common gap identified.*

### What it is

A `ClarificationRequest` is a first-class response type the orchestrator returns
when it needs user input before it can produce a result. It is distinct from a chip:
a chip executes a pre-bound action; a clarification request collects information.

```ts
interface ClarificationRequest {
  type: "clarification";
  intent: string;                // what the system will do once answered
  questions: ClarificationField[];
}

interface ClarificationField {
  field: string;                 // "date" | "age" | "residency" | "game_species"
  prompt: string;                // "What date are you going?"
  input_type: "text" | "number" | "select" | "boolean";
  options?: string[];            // for select: ["comedy", "theatre", "music"]
  target: "active_filters" | "user_attributes";  // where the answer is stored
}
```

The full orchestrator response is a discriminated union:

```ts
type OrchestratorResponse =
  | { type: "result"; handle: ResultHandle; chips: Chip[]; viz: VizHint;
      pending_clarification?: ClarificationRequest }   // result + follow-up questions
  | { type: "clarification"; request: ClarificationRequest }  // no result yet
  | { type: "not_supported"; message: string; supported: string[] }
  | { type: "error"; error: string; message: string };
```

`type: "clarification"` is returned when there is *no meaningful result yet* (hunting
licence before age/residency are known). `pending_clarification` on a `type: "result"`
is returned when a result exists but the regulatory adapter's `next_questions` array
is non-empty — e.g. "You are eligible for a provisional licence. What type of vehicle
do you intend to operate?". The frontend renders the result first, then appends the
inline form beneath it. A new `type: "result_with_clarification"` union member is
explicitly avoided — it would proliferate as more hybrid states emerge.

On submit, the frontend sends `{sessionId, answers: {date: "2025-08-23"}}`. The
orchestrator stores each answer in the appropriate session slot (`active_filters` or
`user_attributes`, per `ClarificationField.target`) and re-executes the original
intent with the collected context.

### Regulatory Adapter

A new adapter type for eligibility and decision-tree domains. These domains do not
return spatial rows and do not go through the geocoder.

```ts
interface DecisionResult {
  eligibility: "eligible" | "ineligible" | "conditional";
  conditions: string[];          // "Must complete Food Hygiene Level 2"
  next_questions: ClarificationField[];  // further attributes needed
  references: string[];          // links to official guidance
}
```

A `RegulatoryAdapter` produces a `DecisionResult`, which becomes a `ResultHandle`
with `type: "decision_result"` and `has_regulatory_reference` capability. Regulatory
results are not written to `query_results`. The frontend renders them with a
structured requirements list component, not a map or chart.

### What this enables

| Story | ClarificationRequest | Regulatory adapter |
|---|---|---|
| Edinburgh Fringe: date + category before showing results | ✅ filter questions | ❌ (data query — use Option C: return all + filter chips) |
| Alaska Hunting: age + residency before licence type | ✅ attribute questions | ✅ decision tree |
| Food business: new vs. change of use | ✅ attribute questions | ✅ eligibility checklist |

### What it does not replace

Chips that effectively ask a question ("What game are you hunting?") use
`action: "clarify"` and open an inline input rather than executing immediately. The
response to a `clarify` chip is stored in `user_attributes` and re-executes the
current regulatory query. This keeps the chip component reusable while supporting
the clarification flow.

---

## ◆◆ Feature 7 — Cross-Domain Reasoning

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
    ├─ User location in session (A.4)      ← "near me" works permanently ✅
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
    │   C.0 Define ConversationMemory, ResultHandle, Chip, ClarificationRequest ← prerequisite
    │       types only — no implementation. All downstream phases import from here.
    │   C.1 QueryRouter built first with stub tools ← routing proven before real tools
    │   C.2 Result shape → capability inference → chip generation hook
    │   C.3 Chip ranker: score all valid chips, return top 3
    │   C.4 Seed DomainRelationship table (5 curated ranking entries)
    │   C.5 suggest_followups post-result hook wired to C.2 + C.3 + C.4
    │   C.6 Action chips in result UI
    │   C.7 ConversationMemory store: expand session from location-only
    │       active_plan set on every successful execution
    │       result_stack updated (push, cap at N=5)
    │       active_filters accumulated across turns
    │   C.8 Ephemeral ResultHandle: handle type where data lives in session
    │   C.9 Log-based relationship pattern discovery
    │   C.10 Spatial artifact snapshots (isochrone + route stored in createSnapshot)
    │   ✓ STRESS TEST: cinema → travel, crime → trends
    │
Phase D — Clarification + Regulatory + Routing Maturity (weeks 8–12)
    │   D.1 ClarificationRequest response type in orchestrator
    │   D.2 Frontend inline form renderer for ClarificationRequest
    │   D.3 Clarify chip action: opens inline input, stores to user_attributes
    │   D.4 Regulatory adapter type (DecisionResult, no geocoder, no query_results)
    │       First example: UK food business registration eligibility
    │   D.5 User attributes in session (expanded via D.1 collect flow)
    │   D.6 Workflow templates (reachable-area, itinerary, cross-domain)
    │   D.7 Composite query decomposition (two domains + spatial join)
    │   D.8 Relationship auto-discovery from session co-occurrence logs
    │   D.9 Seed hunting zones domain in curated registry
    │   D.10 Full hunting license → zones → reachable area flow
    │   ✓ STRESS TEST: multi-domain spatial + clarification flow
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

Suggestions are the primary UX investment. Begin with the type definitions (C.0)
and the QueryRouter (C.1) with stub tools so routing logic is proven before real
tools exist, then layer real tools in as Phase B delivers them.

| Item | What | Dependency |
|---|---|---|
| **C.0** | **Define `ConversationMemory`, `ResultHandle`, `Chip`, `ChipAction`, `ClarificationRequest` types in `types/connected.ts`. Types only — no implementation. Prerequisite for all downstream items.** | None |
| C.1 | QueryRouter — Tier 1 templates + Tier 2 relationship lookup + Tier 3 LLM fallback (stub tools initially) | C.0 |
| C.2 | Result shape → capability inference → chip generation hook | C.0, B.1 |
| C.3 | Chip ranker: score all valid chips, return top 3 | C.2 |
| C.4 | Seed DomainRelationship table (5 ranking entries: cinema→travel, flood→transport, etc.) | C.1 |
| C.5 | `suggest_followups` post-result hook wired to C.2 + C.3 + C.4 | C.2, C.3, C.4 |
| C.6 | Action chips in result UI | C.5 |
| C.7 | ConversationMemory store — expand Redis session to full `ConversationMemory` shape. Size limits enforced on write: `user_attributes` max 50 KV pairs (keys ≤ 64 chars, values ≤ 2,000 chars); `active_filters` max 20 KV pairs (same size limits); total serialised `ConversationMemory` max 64KB; session TTL 24h of inactivity. Writes exceeding limits log a warning and drop the offending key — never reject the write. | C.0 |
| C.8 | Ephemeral ResultHandle — handle type where data lives in Redis (not `query_results`), capped at 100 rows, TTL 1h, evicted from result_stack when stack exceeds N=5 | C.0, C.7 |
| C.9 | Log-based relationship pattern discovery (Tier 3 calls logged → promoted) | C.1 |
| C.10 | Spatial artifact snapshots — extend `createSnapshot` to store isochrone polygons and route polylines | B.4 |

**Phase C acceptance criteria (stress tests):**
- [ ] **Cinema → travel**: user queries cinema listings, clicks "Directions to [Venue]" chip, `calculate_travel` fires with resolved coordinates from `ResultHandle`, travel result returned
- [ ] **Crime → trends**: user queries crime in an area, clicks "Show trend over 6 months" chip, `group_by_time` fires, bar chart rendered with monthly breakdown
- [ ] **Near-me chip**: user queries "crime near me", session carries location, chips include "Show last 6 months" — click uses `active_plan` from session to re-run with date range

---

### Phase D — Clarification + Regulatory + Routing Maturity (weeks 8–12)

No Mastra in this phase. The QueryRouter handles composition. ClarificationRequest
and regulatory adapter land here because they depend on the `ConversationMemory`
primitives from Phase C.

| Item | What | Dependency |
|---|---|---|
| D.1 | `ClarificationRequest` response type in orchestrator | C.0 |
| D.2 | Frontend inline form renderer for `ClarificationRequest` | D.1 |
| D.3 | Clarify chip action: `action: "clarify"` opens inline input, stores answer to `user_attributes`, re-executes | D.1, C.6 |
| D.4 | Regulatory adapter type — `RegulatoryAdapter` producing `DecisionResult`, no geocoder, no `query_results` write | C.0 |
| D.5 | First regulatory domain: UK food business registration eligibility | D.4 |
| D.6 | `user_attributes` collection flow: clarification answers routed to `session.user_attributes` | D.1, C.7 |
| D.7 | Workflow templates: reachable-area, itinerary, cross-domain overlay | C.1, B.5 |
| D.8 | Composite query decomposition (two domains + spatial join) | D.7, B.5 |
| D.9 | Relationship auto-discovery from session co-occurrence logs | C.9 |
| D.10 | Seed hunting zones domain in curated registry | None |
| D.11 | Full hunting license → zones → reachable area flow | D.4, D.6, D.8, D.10 |

**Phase D acceptance criteria (stress tests):**
- [ ] **Regulatory clarification**: user asks "How do I get a hunting license for Alaska?", system returns `ClarificationRequest` for age + residency, user answers, system re-executes and returns `DecisionResult` with eligibility and conditions
- [ ] **Multi-domain spatial**: user queries "hunting zones within 2 hours of Edinburgh by train", system fetches hunting zones domain, computes isochrone via `calculate_reachable_area`, intersects via `overlay_spatial_data`, returns ranked filtered results

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

## ◆◆ Story Coverage Matrix

Six user stories from `USER_STORIES.md` mapped against the architecture components:

| Story | Capability chips | QueryRouter | ConversationMemory | ClarificationRequest | Regulatory adapter | Spatial tools |
|---|---|---|---|---|---|---|
| 1. Edinburgh Fringe | ✅ steps 3–5 | ✅ refinement | ✅ active_filters | ✅ step 2 | ❌ | ✅ travel |
| 2. Alaska Hunting | ✅ steps 3–5 | ❌ | ✅ user_attributes | ✅ steps 1–2 | ✅ | ✅ map |
| 3. Crime refinement | ✅ | ✅ active_plan merge | ✅ active_plan | ❌ | ❌ | ❌ |
| 4. Flood + transport | ✅ | ❌ | ✅ ephemeral handle | ❌ | ❌ | ✅ overlay |
| 5. Food business | ✅ steps 3–5 | ❌ | ✅ user_attributes | ✅ step 2 | ✅ | ✅ overlay |
| 6. Cycle + crime | ✅ | ✅ decompose | ❌ | ❌ | ❌ | ✅ overlay + rank |

Stories 1, 2, and 5 all require `ClarificationRequest`. It is the most common gap
and the highest-priority addition after capability chips and `ResultHandle`.

---

## Items Deferred

| Item | Reason for deferral |
|---|---|
| Video generator (Remotion) | Not connected to spatial data reasoning |
| Audio generator (Magenta) | Not connected to spatial data reasoning |
| 3D scene generator (Three.js) | Not connected to spatial data reasoning |
| Autonomous tool discovery | Premature — tool library needs to stabilise first |
| Feedback collection loop | Valuable eventually, not blocking anything now |
| Tool composition error handling (`CompositeTool.partialResults`) | Real failure modes only emerge from production chains. Define the `warnings[]` partial-result pattern after Phase B tools are running against live data — not before. The individual `Tool.fallback` contract covers the single-tool case in the meantime. |
| Pre-computed domain affinity index | Replace the hot-path `DomainRelationship` lookup with a nightly-computed Redis sorted set (`affinity:{domain_a}:{domain_b}` → co-occurrence score 0–1). Move scoring weights from hardcoded constants to a `ScoringConfig` object loaded at startup so they can be tuned without a deploy. Implement in Phase D after C.4 seeds the relationship table and real co-occurrence data exists to compute from. |
| Refinement classifier cache (pgvector tier) | Add a Tier 2 between regex patterns and the LLM fallback: embed the query text and search for previously-classified refinements above a similarity threshold (e.g. 0.85). Reuses the existing pgvector infrastructure from the semantic classifier. Implement in Phase D.9 alongside relationship auto-discovery, once real refinement examples are in production. |
| `FetchCoordinator` for parallel domain deduplication | Request-scoped identity map that deduplicates concurrent identical domain+params fetches and checks `result_stack` before hitting the network. Needed for Phase D.8 composite query decomposition (Story 6: cycle + crime). `inflight` map keyed on `domain + stableHash(params)`, cleared on promise settlement. |

The itinerary generator from ideas.txt Phase 2.5 is **not** deferred — it is a
workflow template in Phase D, which is the correct home for it.

---

## Summary

The connected query problem has two separable parts: **conversational resolution**
(what does "it" mean?) and **structured invocation** (what coordinates do I pass
to the travel API?). These require different solutions and should not be conflated.

**There are two modes of connection — keep them separate.** Capability extension
(chips) and clarification (structured questions) are qualitatively different. A chip
pre-binds an action. A `ClarificationRequest` collects information before any action
is possible. Do not conflate them in the UI or the backend. For data queries, return
results immediately and offer filter chips. For regulatory/eligibility queries, issue
a `ClarificationRequest` — there is no meaningful "all" result without eligibility
attributes.

**Proactive suggestions are the primary investment.** When the system surfaces
"Directions to Odeon Braehead" as a clickable chip, the coordinates are already
embedded in the pre-bound args. The user clicks, the tool fires, no session lookup
required. Most users will click. The hard follow-up resolution path — session memory,
Mastra thread traversal — exists for the minority who type free-form follow-ups.
Design for the majority first.

**`ResultHandle` replaces ad-hoc result references.** A typed handle carries both
the data pointer and the inferred capabilities. Tools and chips operate on handles,
not raw rows or query IDs. The handle's `ephemeral` flag separates real-time data
(in-session) from persistent data (in `query_results`) without changing how chips
interact with the result.

**`DomainRelationship` is a ranking weight, not a routing signal.** Capabilities
drive chip generation. Relationships adjust chip ranking. A chip for "Show affected
transport routes" appears because the flood result `has_coordinates` — not because
a relationship entry exists. The relationship entry boosts that chip's rank above
alternatives. If the entry is missing, the chip still appears with a lower score.

**Session memory is split into two stores with different lifecycles.**
`QueryContext` (TTL 24h, expires with the session) holds `active_plan`,
`result_stack`, `active_filters`, and `location`. `UserProfile` (TTL 30 days,
refreshed on use) holds `user_attributes` and `location_history`. This separation
means eligibility attributes collected during a hunting licence query (age,
residency) are still present when the user returns next week — they do not expire
with the session. `ConversationMemory` is the composed view of both, used by
the QueryRouter and chip ranker. `ResultHandle` storage uses a single Redis hash
(`session:handles:{sessionId}`) so all handles for a session are cleaned up with
one `DEL` rather than a `SCAN + multi-delete`.

`active_plan` enables free-text refinement merging via pattern-matching first, LLM
fallback second — same three-tier principle as the QueryRouter. `result_stack` (last
N handles) enables step-N chips that reference step-M results. `active_filters`
follow replacement semantics per type: category, date, and location filters replace
on each turn; only negation/exclusion filters compose.

**Chips carry a validity guarantee.** Before executing any chip, the orchestrator
validates that its `args.ref` handle is present in both `result_stack` and Redis. A
stale reference returns a `stale_reference` error type — not a 500, not a generic
error message. The frontend renders a calm "no longer available" notice. Ephemeral
handles expire after 1 hour; the chip payload has no expiry — the validation step
is what bridges this gap.

**Build a simple QueryRouter before Mastra.** Three-tier routing — templates →
relationships → LLM fallback — can be expressed in ~200 lines of testable code.
Mastra is warranted only when ≥ 10 tools are in production and the composition
logic becomes genuinely intractable. That threshold is a decision point at Phase E,
not a commitment made now.

**Define types before any tool is built (Phase C.0).** `ConversationMemory`,
`ResultHandle`, `Chip`, and `ClarificationRequest` must be declared as types before
any implementation starts. Every downstream phase imports from the same source of
truth. Retrofitting types onto an existing implementation always reveals mismatches
that require expensive refactoring.

**The spatial tool library is not optional infrastructure.** It is the vocabulary
the agent speaks. Cross-domain reasoning without spatial tools produces a system
that can describe data relationships but not act on them.

The recommended sequence — data quality → spatial tools (progressive) → types +
suggestions + routing → clarification + regulatory + routing maturity → cross-domain
— delivers standalone user value at every phase. No phase is purely foundational.
