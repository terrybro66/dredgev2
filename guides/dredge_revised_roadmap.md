# DREDGE Roadmap (Revised)

## Guiding Principles

- Prioritize composability over complexity
- Ship value early, expand based on usage
- Keep humans in the loop for high-risk decisions
- Build intelligence on top of reliable primitives

---

# Phase 1: Foundation --- Zero-Code Domain Addition (UNCHANGED, HIGH PRIORITY)

## Goal

Enable domains and data sources to be added without code changes.

## Key Deliverables

- Hybrid `query_results` table
- Database-backed Domain + DataSource models
- Hot-reloadable registry
- Functional registration pipeline (fix current gap)
- Admin approval interface

## Notes

This is the **critical unlock** for the system. Nothing else scales
without it.

---

# Phase 2: Output Generators --- Focused Video Generation

## Goal

Introduce a single high-quality output type: **video generation**

## Why Video Only

- Avoid overbuilding (audio + 3D deferred)
- Validate demand for multimodal outputs
- Concentrate effort on one excellent experience

## Architecture

Query → Data → Video Generator → Artifact

## Components

### 2.1 Output Generator Interface

(Standard interface retained)

### 2.2 VideoGenerator (Remotion)

- Script generation from intent + data
- Scene composition (text, images, transitions)
- Asset sourcing (images, icons)
- Optional narration (future)

### 2.3 Artifact Storage

- Store video config + rendered output URL

## Example Use Case

Query: "How do I compose a song in BandLab" → Scripted explainer video
with steps + visuals

## Deliverables

- Output generator interface
- VideoGenerator (Remotion)
- Basic asset sourcing system
- Frontend video rendering

## Deferred

- Audio generation
- 3D scenes

---

# Phase 3: Tool Library --- Core Primitives (UNCHANGED)

## Goal

Create reusable building blocks for reasoning

## Core Tools

- fetch_data
- calculate_travel
- calculate_reachable_area
- optimize_schedule
- filter_by_constraints
- rank_by_preference
- group_by_location

## Additions

- Strong caching layer (critical for cost control)

---

# Phase 3.5: Lightweight Query Planner (NEW)

## Goal

Provide structured reasoning **before full agent**

## Approach

Deterministic workflow routing: - itinerary → predefined pipeline -
exploration → fetch + rank - location queries → geospatial tools

## Benefits

- Faster implementation than full agent
- More predictable outputs
- Covers majority of use cases

---

# Phase 4: Reasoning Agent (Guarded)

## Goal

Introduce LLM agent for flexible reasoning

## Changes from Original Plan

- Strong tool constraints (no freeform reasoning)
- Output validation layer required
- Prefer workflow templates over open-ended planning

## Agent Capabilities

- Compose tools
- Handle ambiguous queries
- Personalize via memory

## Safeguards

- Tool result validation
- Limited tool access initially
- Fallback to deterministic planner

---

# Phase 5: Controlled Discovery (Modified)

## Goal

Assist expansion without full autonomy

## Changes

- NO full auto-registration by default
- Human-in-the-loop remains standard

## Limited Automation Allowed

Auto-approval ONLY if: - Source is from trusted domain - Read-only
access - High confidence (\>0.95) - Low cost risk

## Focus Areas

- Improve source ranking
- Improve schema inference
- Improve approval UX

---

# Cross-Cutting Concerns

## Cost Control

- Aggressive caching (travel, queries)
- Precomputation for popular domains
- Usage quotas

## Data Integrity

- Source validation
- Monitoring for schema drift
- Fallback mechanisms

## Performance

- Indexing strategy for hybrid table
- Monitor query performance
- Optimize JSONB usage

---

# Timeline (Revised)

Phase Name Duration

---

Phase 1 Zero-Code Domains 2--3 weeks
Phase 2 Video Generator 2--3 weeks
Phase 3 Tool Library 2--3 weeks
Phase 3.5 Query Planner 1--2 weeks
Phase 4 Reasoning Agent 3--4 weeks
Phase 5 Controlled Discovery 2--3 weeks

---

# Final Notes

This roadmap focuses on: - Delivering value early - Avoiding premature
complexity - Building toward intelligence incrementally

Key strategy: **One strong capability per phase \> many partial ones**

Phase 1 — Zero-Code Domains (CRITICAL PATH)
🎯 Milestone: “Domains can be added via DB and actually work”

1. Database Foundation
   Ticket: Create query_results table

Type: Backend
Effort: 1–2 days
Tasks:

Create table schema

Add partial indexes per domain

Add migration script

Backfill (if needed)

Done when:

Table exists and can store multiple domain results

Indexed queries work for at least 1 domain

Ticket: Add Domain + DataSource models (Prisma)

Effort: 1 day
Tasks:

Define Domain model

Define DataSource model

Add enums (DataSourceType, RefreshPolicy)

Run migration

Done when:

You can create domains + sources via DB

2. Registry Refactor
   Ticket: Implement DB-backed DomainRegistry

Effort: 2–3 days
Tasks:

Replace in-memory config loading

Load domains from DB

Build adapters dynamically

Done when:

System boots using DB domains only

Ticket: Add hot-reload for domains

Effort: 1–2 days
Tasks:

Implement reloadDomain(domainName)

Hook into admin/update flow

Done when:

Updating a domain updates behavior without restart

3. Adapters
   Ticket: Implement GenericAdapter (persistent)

Effort: 2 days
Tasks:

Fetch from sources

Map fields

Write to query_results

Ticket: Implement EphemeralAdapter

Effort: 1–2 days
Tasks:

Fetch data

Return without storage

4. Registration Flow (Fix the current gap)
   Ticket: Implement registerDomain workflow

Effort: 3–4 days
Tasks:

Read discovery record

Create Domain + DataSources

Handle persistent vs ephemeral

Trigger registry reload

Done when:

Approved domain becomes queryable

Ticket: Build Admin Approval API

Effort: 2–3 days
Tasks:

Approve/reject endpoint

Override configs

Track status

5. Migration
   Ticket: Migrate existing domains (crime/weather)

Effort: 2 days
Tasks:

Move configs into DB

Validate queries still work

✅ Phase 1 Exit Criteria

You can add a domain via DB → query works

No code changes required

Discovery → approval → live is functional

🎬 Phase 2 — Video Generator (FOCUSED)
🎯 Milestone: “A query can return a generated video”

1. Core Interface
   Ticket: Implement OutputGenerator interface

Effort: 1 day
Tasks:

Define interface

Add OutputRouter skeleton

2. Video Generator (Remotion)
   Ticket: Setup Remotion pipeline

Effort: 2–3 days
Tasks:

Install + configure Remotion

Create base composition

Render test video

Ticket: Script generation from query

Effort: 2–3 days
Tasks:

Convert intent → structured script

Sections: intro, steps, summary

Ticket: Scene builder

Effort: 3–4 days
Tasks:

Map script → scenes

Add text overlays

Add transitions

Ticket: Asset sourcing (images/icons)

Effort: 2–3 days
Tasks:

Integrate image API (or scraping helper)

Match assets to script steps

Ticket: Video rendering + storage

Effort: 2 days
Tasks:

Render to file

Upload/store URL

Save artifact record

3. Integration
   Ticket: Hook OutputRouter into query pipeline

Effort: 1–2 days

Ticket: Frontend video playback

Effort: 1–2 days

✅ Phase 2 Exit Criteria

Query → video artifact

At least 1 strong use case (e.g. tutorials)

🧰 Phase 3 — Tool Library
🎯 Milestone: “Core reasoning primitives exist”
Ticket: Implement fetch_data tool

Effort: 1 day

Ticket: Implement calculate_travel

Effort: 2–3 days

Ticket: Implement optimize_schedule

Effort: 3–4 days

Ticket: Implement filtering + ranking tools

Effort: 2–3 days

Ticket: Implement grouping (geo clustering)

Effort: 2 days

Ticket: Add caching layer (CRITICAL)

Effort: 2–3 days
Tasks:

Cache travel queries

Cache domain fetches

✅ Phase 3 Exit Criteria

Tools usable independently

Can power workflows without LLM

⚙️ Phase 3.5 — Lightweight Query Planner (NEW)
🎯 Milestone: “Structured reasoning without agent”
Ticket: Define workflow templates

Effort: 1–2 days

Examples:

itinerary

exploration

location search

Ticket: Implement planner router

Effort: 2–3 days

Ticket: Execute workflows using tools

Effort: 2–3 days

✅ Phase 3.5 Exit Criteria

Complex queries work without LLM

Deterministic, debuggable outputs

🤖 Phase 4 — Reasoning Agent (Guarded)
🎯 Milestone: “Agent can compose tools safely”
Ticket: Integrate Mastra agent

Effort: 2–3 days

Ticket: Tool binding to agent

Effort: 1–2 days

Ticket: Agent execution loop

Effort: 2–3 days

Ticket: Output validation layer

Effort: 2–3 days
Tasks:

Validate tool outputs

Prevent hallucinated results

Ticket: Memory (basic)

Effort: 2 days

Ticket: Fallback to planner

Effort: 1–2 days

✅ Phase 4 Exit Criteria

Agent works for ambiguous queries

Safe fallback exists

🔍 Phase 5 — Controlled Discovery
🎯 Milestone: “Discovery assists, not replaces humans”
Ticket: Improve discovery ranking

Effort: 3–4 days

Ticket: Improve schema inference

Effort: 3–4 days

Ticket: Build approval UX improvements

Effort: 2–3 days

Ticket: Limited auto-approval system

Effort: 3–4 days
Rules:

trusted sources only

read-only

high confidence

❗ DO NOT:

Fully auto-register everything

✅ Phase 5 Exit Criteria

Discovery reduces manual work

Humans still control risk

🧭 Suggested Execution Order (Important)

Don’t strictly follow phases—do this:

Step 1 (NOW)

Phase 1 fully

Step 2

Phase 3 (tools) before video polish

Step 3

Phase 2 (video)

Step 4

Phase 3.5 (planner)

Step 5

Phase 4 (agent)

Step 6

Phase 5 (discovery improvements)
