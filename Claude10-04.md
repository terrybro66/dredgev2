apps/
orchestrator/ ← Express API (port 3001)
src/
**mocks**/ ← prismaMock + global beforeEach reset
**tests**/ ← ~75 test files (vitest)
agent/
domain-discovery.ts ← agentic source discovery
shadow-adapter.ts ← fallback recovery
search/catalogue.ts ← data.gov.uk search
search/serp.ts ← SerpAPI search
domains/
crime-uk/ ← police.uk API, time-series, GB only
weather/ ← Open-Meteo, global
cinemas-gb/ ← Overpass API, persistent Track A
hunting-zones-gb/← NE ArcGIS CRoW open access land, GB
food-business-gb/← regulatory adapter (eligibility only)
hunting-licence-gb/← regulatory adapter
geocoder/ ← wraps geocodeToCoordinates, ephemeral
travel-estimator/← haversine + speed table, ephemeral
registry.ts ← DomainAdapter interface + Map
semantic/
classifier.ts ← pgvector cosine similarity routing
embedding.ts
pattern-store.ts ← recordSuccessfulPattern (E.2, not yet wired)
types/
connected.ts ← Chip, ResultHandle, WorkflowTemplate etc.
providers/ ← rest, csv, xlsx, pdf, scrape
enrichment/ ← deduplication, scheduler, source-tag, source-scoring
availability.ts ← tracks available months per source
capability-inference.ts ← inferCapabilities, generateChips, DOMAIN_CHIPS
clarification.ts ← buildClarificationRequest
co-occurrence-log.ts
conversation-memory.ts ← ResultHandle store, session result_stack
curated-registry.ts
execution-model.ts ← createSnapshot
export.ts
followups.ts
geocoder.ts ← Nominatim + GeocoderCache
index.ts ← Express entry, loadDomains, police availability load
intent.ts ← parseIntent, deriveVizHint, expandDateRange
itinerary-assembler.ts ← pure fn, hunting day schedule (E.3)
query-router.ts ← 3-tier router (template / refinement / similarity)
query.ts ← POST /parse and POST /execute
regulatory-adapter.ts ← RegulatoryAdapter registry
session.ts ← getUserLocation / setUserLocation (Redis, 24h TTL)
suggest-followups.ts
workflow-executor.ts ← executeWorkflow, step I/O mapping
workflow-templates.ts ← WORKFLOW_TEMPLATES (4 templates)
web/ ← React frontend (port 5173), App.tsx is monolithic
packages/
database/prisma/schema.prisma ← source of truth for all DB models
schemas/src/index.ts ← Zod schemas shared across apps
