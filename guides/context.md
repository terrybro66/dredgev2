For a fresh session starting the roadmap, here's the minimal necessary context, prioritized:

Essential (read first, understand everything)

/Users/terrybroughton/work/dredgev2/CLAUDE.md — architecture overview, what exists, known gaps
.claude/roadmap-v3.md — the plan itself, phases, priorities
.claude/audit.md — what the audit found (10 systems, what's wired vs. dormant)
packages/schemas/src/index.ts — all Zod schemas (DomainConfig, Capability, Chip, ResultHandle, etc.)
Code structure (for Immediate phase)

apps/orchestrator/src/query.ts (lines 1360–1444: /chip endpoint) — where generic handler goes
apps/orchestrator/src/conversation-memory.ts (lines 1–60: interface, key builders) — result_stack storage
apps/orchestrator/src/capability-inference.ts (full file) — how chips are generated
apps/orchestrator/src/domains/registry.ts (loadDomains, DomainAdapter interface) — how adapters are registered
apps/orchestrator/src/domains/generic-adapter.ts — the execution engine for all domains
Code structure (for Phase 0)

apps/orchestrator/src/domains/crime-uk/index.ts — the template to convert to config
apps/orchestrator/src/domains/weather/index.ts — the second template
packages/database/prisma/schema.prisma — DB models, especially DataSource and DomainDiscovery
apps/orchestrator/src/agent/domain-discovery.ts — discovery pipeline and where approve is broken
apps/orchestrator/src/agent/registration.ts — registerDiscoveredDomain, how domains go live
Code structure (for Phase 1)

apps/orchestrator/src/agent/workflows/domain-discovery-workflow.ts — where discovery proposes config
apps/orchestrator/src/**tests**/admin-discovery.test.ts — how admin approval endpoint works
Code structure (for Phase 2)

apps/orchestrator/src/domain-relationships.ts — static relationship seeds
apps/orchestrator/src/relationship-discovery.ts — how learned co-occurrence merges with seeds
apps/orchestrator/src/chip-ranker.ts — how chips are scored
apps/web/src/App.tsx (lines 2169–2337: handleChipAction) — where frontend chip handlers are
Code structure (for Phase 3)

apps/orchestrator/src/schema.ts — the evolveSchema function (fully implemented, never called)
apps/orchestrator/src/suggest-followups.ts — the generic follow-up system to understand before unifying
Tests (validate understanding)

apps/orchestrator/src/**tests**/capability-inference.test.ts — how capability detection is tested
apps/orchestrator/src/**tests**/crime-uk-fetcher.test.ts — crime adapter pattern
apps/orchestrator/src/**tests**/query.test.ts — full query pipeline tests
Memory files (context without reading full code)

.claude/projects/-Users-terrybroughton-work-dredgev2/memory/MEMORY.md — index to memory system
.claude/projects/-Users-terrybroughton-work-dredgev2/memory/project_audit.md — one-liner summary of audit findings
Reading order for a fresh session:

Day 1 (understanding):

CLAUDE.md (30 min)
roadmap-v3.md (30 min)
audit.md (20 min)
Memory index + project_audit.md (10 min)
Before Immediate phase:

query.ts /chip endpoint (10 min)
conversation-memory.ts interfaces (10 min)
capability-inference.ts (20 min)
registry.ts + generic-adapter.ts (20 min)
Before Phase 0:

crime-uk/index.ts (15 min)
weather/index.ts (15 min)
schema.prisma (10 min)
Before Phase 1:

domain-discovery.ts (20 min)
registration.ts (15 min)
domain-discovery-workflow.ts (20 min)
Dependency: Don't read Phase 3–4 code files before Phase 0 is complete. The code will change during Phase 0, so deep dives into schema.ts and suggest-followups.ts will be outdated.

Shortcut: If starting Immediate phase only (no Phase 0 work)

Just read:

CLAUDE.md
roadmap-v3.md (Immediate section only)
query.ts (chip endpoint)
conversation-memory.ts (interfaces)
capability-inference.ts
registry.ts (getDomainByName, DomainAdapter interface)
That's ~3 hours and gives you enough context to wire the generic handler and context carry-forward without touching Phase 0.
