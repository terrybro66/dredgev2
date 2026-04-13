Storage Architecture Split
The split is historical. Crime was the first domain, so it got a dedicated table:

crime_results — columns for every field the police.uk API returns: category, month, street, latitude, longitude, outcome_category, outcome_date, location_type, context, raw (JSONB). The crime-uk adapter writes here directly via Prisma.

weather_results — same pattern for Open-Meteo: date, temperature_max, temperature_min, precipitation, wind_speed, description, raw. The weather adapter writes here directly.

query_results — the generic table, added later when the vision expanded beyond two domains. Fixed columns: date, lat, lon, location, description, category, value, raw, extras (JSONB). Every other domain (cinemas, food hygiene, hunting zones, all discovered domains) writes here. Fields that don't fit the fixed columns go into extras.

The problem is straightforward: crime and weather live outside the generic system. The generic adapter's storeResults flattens any row shape into query_results, stuffing overflow into extras. But the crime-uk and weather adapters bypass this entirely — they write to their own tables with their own column layouts. This means:

evolveSchema (which only targets query_results) can never evolve crime or weather
Any generic query across domains has to know about three tables
MapView in the frontend types as CrimeResult[] because it was built against that table's shape — it reads latitude/longitude instead of lat/lon
The generic extras JSONB works as overflow storage but is never queried, indexed, or promoted to columns — it's a write-only archive
The extras JSONB column was intended to be the bridge. The idea: store everything in extras first, promote frequently-used fields to real columns via evolveSchema. But since evolveSchema is never called, extras is a dead end. Data goes in, nothing comes out.

Chip System End-to-End
The chip system is the mechanism for suggesting actions after a query returns results. It has four stages:

Stage 1 — Capability Inference (capability-inference.ts)
inferCapabilities(rows) inspects the actual data returned by an adapter and detects what the data can do:

has_coordinates — >= 80% of rows have non-null lat + lon (or latitude + longitude). Also checks inside an extras object.
has_time_series — >= 2 distinct date values AND at least one row with a numeric value or count field.
has_polygon — any row has a GeoJSON geometry with type Polygon or MultiPolygon.
has_schedule — any row has both start_time and end_time.
has_category — >= 2 distinct non-empty category values.
Two capabilities are NOT inferred — has_regulatory_reference and has_training_requirement are set explicitly by regulatory adapters when they construct the ResultHandle.

This is pure data inspection. No network calls, no domain knowledge. The thresholds (80%, 2 dates) are hardcoded.

Stage 2 — Chip Generation (generateChips in capability-inference.ts)
Each capability maps to a set of chip templates:

has_coordinates -> "Show on map", "Show as table", "Get directions"
has_time_series -> "Show as chart"
has_polygon -> "Overlay with another layer"
has_schedule -> "See shows that don't clash"
has_category -> "Filter by category"
has_regulatory_reference -> "More information needed"
has_training_requirement -> "Training guidance"

Domain-specific chips are added from DOMAIN_CHIPS:

cinemas-gb -> "What's on here?" (fetch_domain: cinema-showtimes)
hunting-zones-gb -> "Plan a day here" (fetch_domain: hunting-day-plan)

Every chip gets args.ref set to the ResultHandle's ID so it can reference the source result later.

Deduplication uses a composite key of action:domain:constraint:field — if two capabilities would generate the same chip, only the first survives.

Stage 3 — Suppression (generateChips, inside the push function)
Two suppression lists filter chips before they reach the ranker:

Global suppressions — actions that are never emitted regardless of domain:

overlay_spatial — no spatial join implementation exists
clarify — no /clarify backend handler exists
Per-domain suppressions:

crime-uk suppresses calculate_travel — "Get directions" makes no sense for crime incident coordinates
The suppression happens inside the push helper in generateChips. If the action is in either suppression set, it's silently dropped.

Stage 4 — Ranking (chip-ranker.ts)
rankChips scores every surviving chip and returns the top CHIP_DISPLAY_MAX (3):

score = frequency(0.4) + spatialRelevance(0.3) + recency(0.2) + relationshipWeight(0.1)

Frequency (40%) — how often this action type has been clicked in the current session. Normalised: 10 clicks = 1.0. Source: session.ts Redis hash via getChipClickCounts.
Spatial relevance (30%) — 1.0 for chips that act on the result directly (show_map, filter_by). 0.5 for chips that need the user's location and none is stored (calculate_travel, fetch_domain without a session location).
Recency (20%) — where the referenced handle sits in the result_stack. Index 0 (newest) = 1.0, index 1 = 0.7, index 2 = 0.4, not found = 0.1.
Relationship weight (10%) — domain affinity from domain-relationships.ts, boosted by learned co-occurrence from Redis. Example: cinema -> transport: 0.8, flood -> crime: 0.7.
Cold start: frequency = 0, relationship = 0, so most chips score 0 + 0.3 + 0.2 + 0 = 0.50. Travel chips without a session location score 0 + 0.15 + 0.2 + 0 = 0.35. This means map/filter chips naturally surface above travel chips at cold start.

The relationship weights come from getMergedRelationships in relationship-discovery.ts, which merges:

Static seeds from domain-relationships.ts (5 hand-curated pairs)
Learned weights from Redis co-occurrence sorted set (count / 50, capped at 1.0, floor of 0.1)
The merged set takes max(seeded, learned) for known pairs and adds new pairs discovered from usage.

Two Parallel Follow-Up Systems
System 1 — Hand-coded (followups.ts)
generateFollowUps(input) is a big switch statement on input.domain:

crime-uk: "See last 6 months" (expands date range), "All crime types" (if specific category), "Widen search area" (if < 10 results)
weather: "See next month" (if single-month query)
hunting-zones-gb: "Show all open access land" (if filtered), "Widen search area"
flood-risk: "Severe warnings only" (if not already filtered)
everything else: returns []
These return FollowUp[] — each follow-up carries a complete pre-built query plan (plan, poly, viz_hint, location, country_code, intent, months). The frontend can re-execute them by posting the whole plan back to /execute. This is domain-aware drill-down: "I know crime, here's what makes sense to do next with crime data."

System 2 — Capability-inferred (suggest-followups.ts)
suggestFollowups(input) runs the full chip pipeline described above: inferCapabilities -> generateChips -> rankChips. It returns Chip[] — action + args, no pre-built plan. These are domain-agnostic: "your data has coordinates, so here's a map chip."

Both are called from /execute in query.ts. The hand-coded follow-ups go into the response alongside the capability-inferred chips. There's no deduplication between them — a crime result gets both "See last 6 months" (from followups.ts) AND "Show as chart" (from suggest-followups.ts). They're different types (FollowUp vs Chip) rendered differently in the frontend.

The hand-coded system is stronger for within-domain drill-down (it knows crime semantics). The generic system is stronger for cross-domain suggestions and view switching. Neither replaces the other currently.

Biggest Challenges for Connected Queries and Real Insight

1. The chip handler gap is the single biggest blocker
   The chip system generates good suggestions — inference, suppression, and ranking all work. But when you click a cross-domain chip, nothing happens. /query/chip has 3 hand-coded handlers (cinema-showtimes, calculate_travel, hunting-day-plan). Everything else returns 400 unsupported_chip_action. The frontend logs it to console and moves on.

This means the entire capability inference -> chip ranking pipeline produces buttons that don't work. The system infers "this data has coordinates, suggest flood risk" — but clicking it errors. Building a generic fetch_domain handler is the single highest-leverage item. Without it, cross-domain queries are impossible regardless of how good the inference is.

2. Context doesn't carry between queries
   Chips carry args.ref pointing to a ResultHandle ID. The session stores a result_stack in Redis. But the chip handler never reads the stack. When you click "crime in this area" after a flood risk query, the handler has no way to know what "this area" means — it doesn't look up the parent result's location or polygon.

This is what makes connected queries feel like starting over. The user expects "same area" to be implicit. Without context carry-forward, every chip click is a cold start: no location, no date range, no shared context. The result_stack exists precisely for this purpose but nothing reads it.

3. Cross-domain chips don't get generated
   Even if the handler existed, the chip generation step doesn't produce cross-domain suggestions unless they're in DOMAIN_CHIPS (which only has cinema and hunting entries). The domain relationship weights feed the ranker, but the ranker can only score chips that exist — it can't invent new ones. There's a crime -> flood: 0.7 weight in the relationship table, but no chip template says "after crime, suggest flood risk." The relationship data is collected and scored but never materialised into clickable chips.

4. The frontend can't render what it hasn't seen before
   MapView types as CrimeResult[]. BarChart types as CrimeResult[]. DashboardView hardcodes weather fields. When a discovered domain returns generic query_results rows with lat/lon (not latitude/longitude), MapView breaks. When a domain returns time-series data that isn't weather, DashboardView shows empty panels.

TableView is the exception — it reads Object.keys dynamically and works for anything. But "everything renders as a table" is not a good experience for spatial or temporal data. Making MapView and BarChart generic is essential for any domain beyond crime and weather to feel native.

5. Two follow-up systems create incoherent suggestions
   The user sees hand-coded follow-ups ("See last 6 months") mixed with generic chips ("Show as chart") with no shared logic. The hand-coded system understands crime semantics but can't suggest cross-domain actions. The generic system can suggest cross-domain actions but can't express "widen search area" or "all crime types" because those are domain-specific drill-downs. Neither system knows what the other has suggested, so the user gets a flat list of 3-6 suggestions with no coherent narrative.

For real insight, the follow-ups need to tell a story: "You're looking at crime in Leeds — here's how it compares to flood risk in the same area, and here's food hygiene nearby." That requires a single system that understands both domain semantics and cross-domain relationships.

6. No cross-result insight layer
   Even if all the above were fixed, each query result stands alone. There's no mechanism to compare or correlate two results in the stack. Story 1 ends with three separate panels: crime, flood, food hygiene. The user has to mentally connect them. A real insight would be: "This area has higher than average burglary and is in flood zone 3 — consider this when evaluating properties." That requires:

Reading multiple handles from the result stack
Comparing them on shared dimensions (location, time, category)
Generating a natural-language summary
The generateInsight function exists but only summarises a single result. Cross-result insight is the ultimate expression of the connected queries vision, and it's the furthest from being built. The roadmap (Phase 2) gets chips clicking and context carrying — but the insight layer is beyond Phase 3 and would likely need its own phase.

In summary
The infrastructure is better than it looks — inference works, ranking works, co-occurrence learning works, session memory stores the right data. The gaps are in the connective tissue: the chip handler that executes cross-domain queries, the context carry-forward that makes "same area" implicit, the chip generation that turns relationship weights into clickable suggestions, and the frontend rendering that handles any domain. Fix those four and the user experience jumps from "clever single-domain tool" to "connected intelligence."
