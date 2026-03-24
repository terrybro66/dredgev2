# DREDGE — Architecture Blueprint

> A developer guide to building a multi-source data intelligence platform from first principles. This document describes the design decisions, the order in which they were made, and why each step leads naturally to the next.

---

## What DREDGE Is

DREDGE is a natural language query engine for public and commercial data. A user types a plain English question — "burglaries in Camden last month", "what's on at Odeon Braehead", "flood risk in Bristol" — and the platform finds a relevant data source, fetches the data, stores it, and renders an appropriate visualisation. No SQL, no API knowledge required.

The architecture is designed around a single constraint: **adding a new data domain must require zero changes to existing code**. Everything else follows from that.

---

## Part 1 — The Core Pipeline

### Step 1: Intent Parsing

The first challenge is turning a natural language query into something structured enough to route to a data source. This is done by sending the raw query to a language model with a strict system prompt that returns a JSON object containing:

- A **category** — either a known domain slug (e.g. `burglary`, `weather`) or `unknown` for queries that don't match any registered domain
- An **intent summary** — a 2–4 word phrase describing the data domain the user wants (e.g. "cinema listings", "flood risk data"). This is critical: it is the distilled concept that flows into discovery, not the raw user query
- A **date range** — resolved from relative expressions ("last month", "last 3 months") to explicit year-month values
- A **location** — a human-readable place name, never coordinates

The parser must default to `unknown` for non-matching intents rather than forcing everything into a known category. Early versions defaulted to a catch-all crime category, which caused every non-crime query to be misrouted.

The parsed result is returned to the frontend as a confirmation step before execution. This two-step parse-then-execute flow means the frontend can show the user what was understood before committing to a potentially slow data fetch.

### Step 2: Geocoding

The location string from the parser is passed to a geocoding service (Nominatim) which returns a polygon, a display name, and a country code. The polygon is used for spatial queries; the country code drives domain routing.

Geocoding results are cached in the database to avoid repeated calls for the same place name. The cache key is the lowercase-normalised place name.

### Step 3: Domain Routing

With a parsed intent and a country code, the platform looks up which adapter can handle the query. The domain registry is a simple map of `(country_code, intent) → adapter`. Each adapter encapsulates:

- How to fetch data (which API, with what parameters)
- How to flatten a raw API response row into a standard shape
- How to store results in the database
- Configuration: rate limits, cache TTL, refresh policy, visualisation hints

The registry is consulted first. If no registered adapter matches, the query flows into the discovery pipeline (described in Part 3).

### Step 4: Rate Limiting and Caching

Before making any external API call, the platform checks two things:

**Cache**: A deterministic hash is computed from the query parameters (domain, category, date range, resolved location). If a matching cache entry exists and is within its TTL, the stored results are returned immediately without any API call.

**Rate limiter**: Each domain has a configured requests-per-minute limit. A token bucket rate limiter enforces this. Early versions stored rate limiter state in memory, which caused problems under horizontal scaling — each process maintained its own independent counter. Moving this state to Redis ensures all instances share a single rate limit pool.

### Step 5: Data Fetching

The adapter's `fetchData` method is called with the query plan and the polygon. For multi-month queries, months are fetched in parallel with a concurrency limit to avoid hitting rate limits. Each month's fetch is independent; results are flattened into a single array.

External APIs sometimes return 404 for valid queries when no data exists for that combination of category, location, and month. This must be treated as an empty result, not an error. Similarly, 429 responses trigger a brief wait and a single retry.

### Step 6: Recovery Strategies

When the primary fetch returns no results, two fallback strategies are attempted in order:

**Adapter-level recovery**: Some adapters implement a `recoverFromEmpty` method that tries an expanded date range or a broader location.

**Shadow adapter recovery**: If adapter-level recovery also fails, the shadow adapter searches for alternative sources that cover the same intent and location. This is described in detail in Part 3.

### Step 7: Schema Evolution

The database schema for result storage evolves automatically as new data fields are encountered. When a row contains a field that doesn't exist in the current table, an `ALTER TABLE ADD COLUMN` migration is run. This allows domains to be added without manual schema work.

Column names are validated before any DDL is executed — only lowercase alphanumeric names up to 63 characters are accepted. Raw data is always preserved in a `raw` JSON column so no information is lost even if a field is dropped from the mapped schema.

### Step 8: Result Storage and the Execution Model

Results are stored in domain-specific tables (one per domain). After storage, an immutable execution record is created:

A **QueryRun** records the execution metadata — which sources were active, which schema version was used, when it ran, and whether it succeeded.

A **DatasetSnapshot** seals the actual row data with a SHA-256 checksum at the moment of execution.

This separation of definition (the query), execution (the run), and data (the snapshot) is essential for collaborative features. Without it, the same logical query can silently return different results as new sources are discovered or background refreshes run — a subtle bug that is very hard to debug once workspaces and pinned dashboards are in production.

### Step 9: Visualisation Selection

The visualisation type is derived deterministically from the query shape, not from the LLM:

- Single month + spatial data → map
- Multiple months → bar chart (grouped by month)
- Queries containing words like "list", "show me", "details" → table
- Weather data → dashboard

The bar chart path groups raw rows by month and returns counts, not individual rows. Returning raw rows and capping at 100 would only show the first month's worth of data for multi-month queries.

---

## Part 2 — The Provider Layer

### Why Providers Exist

Early versions had one transport mechanism: REST API calls via axios. Adding a new data source meant writing a new adapter from scratch. The provider layer decouples transport from domain logic.

A **Provider** is a module that knows how to fetch raw data from one transport type and return it as rows. The platform ships four providers:

- **RestProvider** — HTTP GET with query parameters, parses JSON response
- **CsvProvider** — downloads a CSV file, parses it with PapaParse
- **XlsxProvider** — downloads an Excel file, parses it with SheetJS
- **PdfProvider** — downloads a PDF, extracts text with pdf-parse

### The Generic Adapter

A **GenericAdapter** reads a `sources` array from a domain's configuration. Each source specifies its URL, transport type, and refresh policy. The generic adapter fans out to the appropriate provider for each source, merges all rows into a single result set, and applies a `flattenRow` function to normalise field names.

A domain with multiple sources (e.g. a REST API plus a weekly CSV supplement) is handled transparently — the query pipeline and frontend see a single unified result.

### Refresh Policies

Each source has a `refreshPolicy` field: `realtime`, `daily`, `weekly`, or `static`. This drives both cache TTL and background scheduling behaviour:

- `realtime` sources bypass the cache and result storage entirely — results are returned to the user and discarded. Movie times, live transport, stock prices should use this policy.
- `daily` and `weekly` sources are registered with the background scheduler, which creates new QueryRun and DatasetSnapshot records on each cycle rather than mutating existing data.
- `static` sources are fetched once and cached indefinitely.

---

## Part 3 — Agentic Discovery

### The Problem

No matter how many domains are registered manually, users will ask questions the platform cannot yet answer. The discovery pipeline is the response to this — it attempts to find a data source autonomously when no registered adapter matches.

### The Search Priority Chain

Discovery always follows the same priority order, stopping as soon as results are found:

**1. Open data catalogue search**
For GB queries, the data.gov.uk API is queried first using the intent summary (not the raw user query). This is instant, free, and returns high-confidence structured results. Results are filtered by relevance — only datasets whose title contains a meaningful word from the intent are kept. This prevents loosely matched catalogue results (a "vets" dataset matching "cinema listings") from being treated as valid sources.

**2. SerpAPI search**
If the catalogue returns nothing, SerpAPI is queried. The search query is built from the intent summary plus country code — again, not the raw user query. Using the raw query ("what's on at Odeon Braehead") produces irrelevant results; using the distilled concept ("cinema listings GB data source") finds relevant sources including official cinema websites and API directories.

**3. Browser-based discovery**
If SerpAPI also returns nothing, a headless browser (Stagehand) navigates to Bing and extracts candidate URLs from the search results page. This is the slowest and most expensive path and should only fire for genuinely novel intents.

### Why Intent Summary Matters

The intent summary is the single most important piece of data flowing through the discovery pipeline. It must be distilled from the raw query before any search happens. "What films are on at Odeon Braehead" is a terrible search query for finding a reusable data source. "Cinema listings" finds exactly the right results.

This distillation happens in the intent parser — the LLM is explicitly instructed to return a `intent_summary` field alongside the query plan. The frontend must pass this field through to the execute endpoint in the request body, and the execute handler must use it as the discovery intent rather than the raw query text.

### URL Resolution

SerpAPI and catalogue results often return landing pages rather than direct data files. A dataset page on data.gov.uk links to the actual CSV; a cinema website displays showtimes as HTML. The `resolveDirectDownloadUrl` function handles this:

- Direct file URLs (ending in `.csv`, `.json`, `.xlsx`, `.pdf`) are returned unchanged — no browser needed
- HTML pages are loaded in a headless browser and Stagehand extracts the direct download URL

### Source Sampling

Once a direct URL is found, a small sample of data is fetched — typically 5–10 rows. The content type determines the parsing strategy (JSON, CSV, or XLSX). If the content type is HTML, the URL needs further resolution.

### Schema Proposal

The sample rows are sent to an LLM with a prompt that describes the intent and asks for a domain name and a field mapping. The field mapping translates source-specific field names to standard names (date, location, value, description, lat, lon). A confidence score between 0 and 1 is returned alongside the proposed config.

### Human-in-the-Loop Review

The pipeline always ends with a human review step. The proposed domain config, sample rows, and confidence score are stored in a `DomainDiscovery` audit table with status `requires_review`. The pipeline returns `null` — it never auto-registers a domain.

An admin approves the discovery record via an endpoint. Only after approval does the domain become registered and available for queries. This gate exists because schema generation is a breaking change — an incorrectly mapped domain would silently corrupt results for all subsequent queries.

### The Shadow Adapter

The shadow adapter is a lighter-weight variant of domain discovery that fires when a **registered** domain returns empty results. Rather than creating a new domain, it finds an alternative source for the existing domain's intent and location, maps its rows to the existing schema, and returns the data for that query. The discovered source URL is written back to the availability cache so subsequent identical queries use it directly without re-running the discovery workflow.

---

## Part 4 — Semantic Understanding

### The Classifier

Domain routing starts with keyword matching — does the query contain "crime", "weather", etc. This is fast but brittle. A semantic classifier replaces it.

Each registered domain has a set of example queries embedded at registration time and stored in a vector database (pgvector). At parse time, the user's query is embedded and compared against all domain embeddings using cosine similarity. The closest match above a confidence threshold wins.

Queries that score below the threshold are flagged for domain discovery rather than being forced into the nearest registered domain.

### Composite Intents

The semantic layer enables queries that span multiple domains — "is this area safe to live in?" can resolve to crime data plus air quality plus housing. Each domain returns its own result, drawing from its most recent snapshot. A synthesis step produces a unified narrative. The composite result records which snapshot ID from each domain was used, making it fully reproducible.

---

## Part 5 — Collaborative Workspaces

### The Consistency Problem

Without immutable snapshots, workspaces are unreliable. A dashboard pinned on Monday shows 120 crime incidents. By Wednesday, the shadow adapter has discovered a CSV supplement and the background scheduler has run. The same query now returns 145 incidents. The pinned dashboard is silently wrong and there is no way to reproduce the original result.

The execution model (QueryRun and DatasetSnapshot) solves this. Workspaces store snapshot IDs, not query IDs. A pinned visualisation always renders from the data that existed when the user saved it. A "refresh" button creates a new QueryRun and DatasetSnapshot and updates the pinned ID on explicit user confirmation.

### Workspace Structure

A workspace is a named collection of saved queries. Each saved query stores the full execute request body and a snapshot ID. Annotations can be attached to any result. A workspace dashboard assembles multiple pinned snapshots into a single scrollable page.

Exported PDF reports embed the snapshot ID and execution timestamp for every panel, providing a complete audit trail.

---

## Part 6 — Background Refresh

### What the Scheduler Does

The refresh scheduler registers adapters with `daily` or `weekly` refresh policies and fires them on a cron schedule. `static` and `realtime` sources are never scheduled.

Each refresh cycle creates a new QueryRun and DatasetSnapshot rather than mutating existing rows. Previous snapshots are preserved. Workspace dashboards that reference an older snapshot continue to render correctly until the user explicitly refreshes them.

### The Key Invariant

The scheduler must never delete or modify existing snapshots. It only appends. This is the mechanism that makes workspaces stable between sessions.

---

## Part 7 — What Comes Next

### The Approved Source Registry

The discovery pipeline is powerful but expensive. A curated registry of known-good APIs — with their intent mappings, refresh policies, and ephemeral/persistent flags — covers the majority of common queries instantly without any LLM calls. The discovery pipeline remains as a fallback for genuinely novel intents not in the registry.

The registry also handles the ephemeral data problem cleanly. A cinema showtimes entry is flagged as `storeResults: false` — results are returned to the user and discarded. The domain config (cinema locations, API endpoint) is stored; the query results are not.

### API Key Management

Some approved sources require API keys. The registry can specify an environment variable name per source. When a required key is not set, the source is skipped gracefully. An admin interface can surface which approved sources are unconfigured.

### The Data Marketplace (Deferred)

Once the approved source registry and discovery pipeline are mature, domain configurations can be packaged and shared across DREDGE instances. Community-contributed packages are versioned, signed, and rated. The marketplace is deferred until the pain of managing per-domain configs manually becomes demonstrable — typically when the domain count reaches a maintenance threshold or when marketplace security requirements can be properly scoped.

### The Query Result Abstraction Layer (Deferred)

The current architecture stores results in domain-specific tables. A universal `QueryResult` envelope — a single table with JSONB columns — would simplify multi-source deduplication, eliminate per-domain migrations, and make marketplace packages smaller and safer. This is deferred until the complexity cost of domain-specific tables is felt in production.

---

## Key Design Principles

These constraints were established early and have guided every subsequent decision:

**`query.ts` is domain-agnostic.** The execute handler calls adapter hooks and never contains domain-specific logic. Adding a new domain requires no changes to the core pipeline.

**Every result row preserves raw data.** A `raw` JSON column on every results table means no information is ever lost, regardless of how the schema evolves.

**Failures in non-critical paths never propagate.** The shadow adapter, semantic classifier, and domain discovery pipeline can all fail without affecting the core execute response. Users get empty results or unsupported_region errors, not 500s.

**Workspace dashboards render from pinned snapshots.** Results do not change between sessions without explicit user action. The stability guarantee is structural, not a matter of discipline.

**The LLM extracts intent only.** The language model never produces coordinates, fabricates data, or makes schema decisions without a validation step. All LLM output is treated as a proposal that must pass schema validation before use.

**Intent summary, not raw query, drives discovery.** The raw user query is a terrible search query for finding reusable data sources. The intent summary — a distilled 2–4 word concept — is what flows into catalogue search, SerpAPI, and Stagehand. This is the single most important detail for getting discovery to produce relevant results.

