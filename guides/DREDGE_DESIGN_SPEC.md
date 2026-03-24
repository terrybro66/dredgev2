# DREDGE — Design Specification

> Forward-looking design document covering the domain/data source relationship, the three query paths, the curated source registry, ephemeral data handling, the registration step, and the scrape provider. Written as a specification for the next phase of development. Read alongside the Architecture Blueprint which covers what has already been built.

---

## 1. The Three Query Paths

Every user query follows one of three paths through the system. Understanding these paths is the foundation for all design decisions in this document.

### Path 1 — Known domain, database hit

The query intent matches a registered adapter. The cache is checked first. If a valid cache entry exists within the TTL, results are returned immediately. On a cache miss, the registered adapter fetches fresh data from its configured sources, stores the results, writes to the cache, and returns to the user.

This path is fully implemented. Crime and weather queries both follow it.

The goal of the rest of the pipeline is to convert novel queries into Path 1 queries over time — once a domain is discovered, approved, and registered, subsequent identical queries take this fast path.

### Path 2 — Novel intent, curated source

No registered adapter matches. The system consults a curated registry of known data sources grouped by intent. If a match is found, data is fetched from the curated source, a schema is generated, and results are returned to the user.

If the data is worth keeping — it is stable, reusable, and not ephemeral — a new domain is registered automatically. Future queries take Path 1. If the data is ephemeral — live showtimes, current prices, real-time transport — it is returned to the user and discarded.

This path is partially implemented. The curated registry does not yet exist. The schema generation and automatic registration step is not implemented.

### Path 3 — Novel intent, no curated source

No registered adapter and no curated source match. The discovery pipeline runs: catalogue search, then SerpAPI, then browser-based scraping. Candidate URLs are found, data is extracted, and results are returned to the user.

The same ephemeral/persistent decision applies. If the data is worth keeping, a `DomainDiscovery` record is created with a proposed config and sample rows, flagged for human review. After approval, the domain is registered and future queries take Path 1.

This path is partially implemented. The discovery pipeline finds URLs and extracts data. The post-approval registration step is not implemented.

---

## 2. The Domain and Data Source Relationship

### The current conflation

In the current codebase, a domain and a data source are effectively the same thing. `DomainConfig` has a single `apiUrl` and an optional `sources` array. The domain owns the schema, the table, the adapter, and the sources all at once. Adding a new source for the same data concept requires either modifying an existing domain or creating a new domain — both of which are heavyweight operations requiring schema migrations.

This conflation creates a specific problem: the same data concept can have many sources. Cinema listings exist at Odeon, Vue, Cineworld, and dozens of independent cinemas. Planning applications exist at every local council. Bus times exist at every transport operator. Under the current model, each source would require a separate domain, a separate table, and a separate adapter. That is the wrong abstraction.

### The correct model

A **domain** defines the data concept. It owns:

- The intent — what questions this domain answers ("cinema listings", "planning applications")
- The country codes it covers
- The canonical schema — what fields every result in this domain has
- The result table — where data from all sources for this domain is stored
- The visualisation rules — how results should be rendered
- The cache and refresh configuration

A **data source** defines how to acquire data for a domain. It owns:

- The URL or URL template
- The transport type — REST, CSV, XLSX, PDF, or scrape
- The extraction prompt — for scrape sources, what to extract from the page
- The field mapping — how source-specific field names map to the domain's canonical schema
- The refresh policy — realtime, daily, weekly, or static
- The `storeResults` flag — whether results should be persisted or discarded after delivery
- A confidence score — how reliable this source is considered to be
- An enabled/disabled flag — so sources can be turned off without deletion

One domain has many data sources. All sources for a domain write to the same table, with a `source_tag` column identifying the origin. The user gets a unified result set regardless of how many sources contributed.

### The DataSource model

The `DataSource` entity should be a first-class database model, separate from the domain config JSON. This enables sources to be added, approved, disabled, and refreshed independently without touching the domain itself.

```
DataSource
  id                String   — primary key
  domainName        String   — foreign key to domain registry
  name              String   — human-readable name e.g. "Odeon UK"
  url               String   — URL or URL template with {location} placeholders
  type              Enum     — rest | csv | xlsx | pdf | scrape
  extractionPrompt  String?  — for scrape sources: what to extract
  fieldMap          Json     — source field → canonical domain field
  refreshPolicy     Enum     — realtime | daily | weekly | static
  storeResults      Boolean  — false for ephemeral sources
  confidence        Float    — 0.0–1.0
  enabled           Boolean  — can be toggled without deletion
  discoveredBy      Enum     — manual | catalogue | serp | browser
  approvedAt        DateTime?
  lastFetchedAt     DateTime?
  lastRowCount      Int?
  createdAt         DateTime
```

### What stays the same

The `DomainConfig` in `packages/schemas` remains the domain-level definition. The `sources` array on `DomainConfig` becomes a derived view of the enabled `DataSource` records for that domain, loaded at startup. The `GenericAdapter` continues to fan out to providers per source. The result table structure is unchanged.

### What changes

The `sources` array on `DomainConfig` is no longer statically defined in code — it is loaded from the `DataSource` table at startup and refreshed when sources are added or modified. Adding a new source to an existing domain requires no code change and no redeployment.

The `apiUrl` field on `DomainConfig` becomes the URL of the primary or default source. It remains for backwards compatibility with existing adapters that have a single hardcoded source.

---

## 3. The Curated Source Registry

### Purpose

The curated source registry is a manually maintained list of known-good data sources, grouped by intent and country code. It sits between the registered adapter lookup and the full agentic discovery pipeline. When a query matches a curated source, data can be fetched immediately without any LLM calls, browser automation, or human review.

The registry answers the question: "For this intent and country, do we already know where to get the data?"

### Structure

The registry is a TypeScript array of curated source definitions. Each entry maps an intent to one or more data sources, with metadata about the source type, refresh policy, and whether results should be stored.

Each entry contains:

- The intent keywords it matches — e.g. "cinema listings", "film showtimes", "what's on"
- The country codes it covers
- One or more data source definitions (URL, type, field map, refresh policy, storeResults flag)
- Whether human approval is required before the source is used, or whether it can be used immediately
- Notes about any API keys required

### Relationship to DataSource

When a curated source is first used successfully, a `DataSource` record is created in the database. On subsequent queries, the database record is used directly — the registry is only consulted for intents that have no existing `DataSource` records.

This means the registry is a seed mechanism, not a permanent lookup. Once a source has been used and stored, it becomes part of the database-driven source system and can be managed there.

### Approval rules

Sources in the curated registry that are well-established open government APIs — Environment Agency flood data, ONS statistics, Transport for London — can be used immediately without human approval. Their field mappings are pre-validated.

Sources that involve commercial website scraping — cinema chains, restaurant review sites, transport operators — require a lightweight approval step before a `DataSource` record is created and the domain is registered. The approval is simpler than the full domain discovery review because the source is already known and the field mapping is pre-defined.

---

## 4. Ephemeral Data Handling

### The problem

Some data has a useful lifetime measured in hours or minutes. Cinema showtimes change daily. Live train times change by the minute. Current stock prices change by the second. Storing this data is wasteful and misleading — a cached showtime from yesterday is worse than no showtime at all.

### Where the decision is made

The ephemeral determination must happen during discovery — when `proposeDomainConfig` runs — not during registration. This is a critical ordering constraint. The registration step branches on `storeResults` to decide whether to create a domain table at all. If the decision were made at registration time, the system would have no basis for the branch.

The `proposeDomainConfig` LLM prompt is extended to ask:

- Is this data ephemeral? (changes faster than daily)
- What is the appropriate refresh policy?
- What is the rationale for this determination?

The proposed config stored in the `DomainDiscovery` record includes these fields:

```
proposed_config: {
  name: "cinema-listings-uk",
  fieldMap: { ... },
  confidence: 0.82,
  refreshPolicy: "realtime",
  storeResults: false,
  ephemeralRationale: "Cinema showtimes change daily and have no historical value"
}
```

The `ephemeralRationale` is shown to the admin during review so the operator understands why the LLM made this determination and can override it if needed.

### The storeResults flag

Each `DataSource` has a `storeResults` boolean. When false, the execute pipeline changes behaviour for that source:

- Results are fetched and returned to the frontend as normal
- No rows are written to the domain result table
- No `QueryCache` entry is created
- No `QueryRun` or `DatasetSnapshot` is created
- The workspace "save" button is disabled for this query — there is nothing to pin

The domain itself is still registered. The `DataSource` record exists. The field mapping, extraction prompt, and URL are all stored. What is not stored is the query result data.

### The refreshPolicy interaction

`refreshPolicy: "realtime"` implies `storeResults: false` in almost all cases — data that changes in real time is rarely worth caching. The scheduler never registers realtime sources. The two flags are independent because there are edge cases: a source might have a `daily` refresh policy but still not be worth storing (for example, a source that only provides the current day's data and has no historical value).

### Admin override

The `POST /admin/discovery/:id/approve` endpoint accepts an optional overrides body. This allows the operator to correct the LLM's ephemeral determination before registration runs:

```json
{
  "overrides": {
    "storeResults": true,
    "refreshPolicy": "daily"
  }
}
```

Overrides are applied to the proposed config before the registration step reads it. The override is recorded on the `DomainDiscovery` record for audit purposes.

### Frontend implications

When a result comes from a `storeResults: false` source, the frontend should:

- Show the results normally
- Suppress the workspace "save" action for this query
- Show a brief label indicating the data is live and not saved — "Live data · not saved"
- Not offer CSV or GeoJSON export (there are no stored rows to export from)

---

## 5. The Registration Step

### What approval currently does

`domainDiscovery.approve()` updates the `DomainDiscovery` record to `status: approved`. Nothing else happens. The proposed config sits in the database but is never acted upon. This is the most critical gap in the pipeline.

### The ephemeral branch

The registration step reads `storeResults` from the proposed config (after any admin overrides are applied) and immediately branches into two distinct paths. This branch is the first thing that happens — it determines the entire shape of what registration does.

```
if proposed_config.storeResults === false  →  ephemeral path
if proposed_config.storeResults === true   →  persistent path
```

These are not minor variations of the same process. They produce fundamentally different outcomes.

### The ephemeral path

When `storeResults` is false:

**1. Validate the proposed config** — parse and validate the proposed config JSON. Halt with `approval_failed` if invalid.

**2. Create the DataSource record** — write the URL, type, extraction prompt, field map, `refreshPolicy: "realtime"`, and `storeResults: false` to the database.

**3. Register a fetch-and-discard adapter** — instantiate a lightweight adapter that fetches, maps rows through the field map, and returns them directly. No `storeResults`, no `QueryCache.create`, no `createSnapshot`. Register it in the domain registry.

**4. Do not create a domain table** — no Prisma model, no migration, no result table. There is nothing to persist.

**5. Mark the record as registered** — update `DomainDiscovery` to `status: registered`.

### The persistent path

When `storeResults` is true:

**1. Validate the proposed config** — same as above.

**2. Check for domain conflict** — if a domain with the same name is already registered, halt and surface the conflict to the admin.

**3. Create the DataSource record** — write source details to the database.

**4. Create or extend the domain** — if no domain exists for this intent and country code, create one using the pre-provisioned canonical schema (see schema approach below). If a domain already exists, link the new `DataSource` to it and validate the field map against the existing canonical schema.

**5. Register a full GenericAdapter** — instantiate the adapter with storage, cache, and snapshot creation. Register it in the domain registry.

**6. Retry the original query** — if discovery was triggered by a specific user query, retry it automatically so the user receives results without re-submitting.

**7. Mark the record as registered** — update `DomainDiscovery` to `status: registered`.

### The schema approach for persistent domains

Generating Prisma models and running migrations at runtime is the most technically complex part of the persistent path. Three approaches exist:

**Approach A — Runtime migration**: Generate the Prisma schema fragment and run `prisma migrate dev` programmatically. Works but is slow and has race conditions.

**Approach B — Universal envelope (Phase 13)**: All results stored in a single `query_results` table with JSONB columns. No migration needed. Cleanest long-term solution but requires Phase 13 to be un-deferred.

**Approach C — Pre-provisioned schema**: Define a fixed set of canonical field names (date, location, value, description, lat, lon, category, count, url, rating, price, duration, title). All domains use only these fields. No migrations needed. Sources map their fields to this fixed vocabulary.

The recommended approach is C for the near term. It constrains what domains can express but eliminates migration complexity entirely. The ephemeral path is unaffected by this choice — ephemeral domains never need a table regardless of the schema approach.

---

## 6. The Scrape Provider

### Purpose

The `ScrapeProvider` is a fifth provider type alongside `RestProvider`, `CsvProvider`, `XlsxProvider`, and `PdfProvider`. It uses Stagehand to navigate to a URL and extract structured data using a natural language prompt and a Zod schema.

### Why it is different from the other providers

The other providers are deterministic — given a URL and a format, the output is predictable. A CSV at a given URL always produces the same structure. The `ScrapeProvider` is non-deterministic — the extraction is driven by an LLM and the page's accessibility tree, and both can vary.

This has two implications. First, scrape sources require an `extractionPrompt` field that the other providers don't need. Second, scrape results need a confidence signal — the LLM may find all the data, some of it, or none of it, and the caller needs to know which.

### The source-level extraction prompt

Each `DataSource` of type `scrape` has its own `extractionPrompt`. This is important because different websites presenting the same data concept have different page structures and require different instructions. The Odeon prompt is different from the Vue prompt even though both extract cinema listings.

The prompt should be specific enough to extract the right data but general enough to work across minor page changes. It should describe what to extract, not how to find it — Stagehand handles the how.

### The extraction schema

Each scrape source defines a Zod schema for the extracted data. This schema is at the source level, not the domain level. The source schema describes the raw extracted shape; the `fieldMap` on the `DataSource` record maps from that shape to the domain's canonical schema.

For cinema listings, the source schema might be:
```
{ films: [{ title, showtime, screen, price, rating, runtime }] }
```

The field map then says: `title → description`, `showtime → date`, `price → value`.

### Integration with the existing pipeline

The `ScrapeProvider` plugs into the `GenericAdapter` the same way the other providers do. When the adapter sees a source with `type: "scrape"`, it calls `ScrapeProvider.fetchData()` instead of `RestProvider` or `CsvProvider`. The returned rows are passed through the field map and stored (or discarded) the same way as any other source.

The `sampleSource` function in the discovery pipeline gains a fourth path — when a direct fetch returns HTML and the URL does not resolve to a downloadable file, `ScrapeProvider` is used to extract a sample. The sample is passed to `proposeDomainConfig` which also proposes an extraction prompt alongside the field map.

### Stagehand configuration for the ScrapeProvider

The pattern established in miniTest.ts is the correct one: standalone Stagehand with `model` as a config object using OpenRouter as the base URL, `stagehand.context.pages()` to get the page, and `stagehand.extract(prompt, schema, { page })` for extraction. The `withStagehand` helper in `stagehand-client.ts` wraps this pattern.

The schema passed to `stagehand.extract` must use `nullable()` on all optional fields. The LLM returns a wrapped JSON Schema object in some cases — the schema validation must be lenient enough to handle this. The `text` field on the error response from `NoObjectGeneratedError` contains the actual extracted data even when schema validation fails, so a fallback parse of the raw text should be attempted before giving up.

---

## 7. The Admin Approval Endpoint

### Routes needed

**`GET /admin/discovery`** — lists all records with `status: requires_review`. Each record shows the intent, proposed domain name, sample rows, confidence score, `storeResults` flag, `ephemeralRationale`, and proposed field map. This is everything an operator needs to make an approval decision.

**`POST /admin/discovery/:id/approve`** — approves a record and triggers the registration step. Accepts an optional body for overrides:

```json
{
  "overrides": {
    "storeResults": true,
    "refreshPolicy": "daily"
  }
}
```

Overrides are applied to the proposed config before registration reads it. The endpoint returns the result of registration — success with the domain name and path taken (ephemeral or persistent), or failure with the reason.

**`POST /admin/discovery/:id/reject`** — marks a record as rejected with a reason. Rejected records do not reappear in the review queue. The same intent can still trigger a new discovery record on future queries.

### The approval flow end to end

1. User query triggers discovery. `DomainDiscovery` record created with `status: requires_review`, including `storeResults` and `ephemeralRationale` in `proposed_config`.
2. Operator calls `GET /admin/discovery` and reviews pending records.
3. Operator calls `POST /admin/discovery/:id/approve` — optionally with overrides if the LLM's ephemeral determination was wrong.
4. Endpoint applies overrides, calls `domainDiscovery.approve()`, then triggers the registration step.
5. Registration step reads `storeResults` and branches into the ephemeral or persistent path.
6. On success, the adapter is live in the domain registry. The user's next query takes Path 1.
7. `DomainDiscovery` record updated to `status: registered`.

### Authentication

These routes must be protected. The existing `better-auth` dependency is installed but not yet wired to any routes. The admin routes should be the first place authentication is enforced.

### The review interface

The minimum viable review interface is a JSON response from `GET /admin/discovery` that an operator can inspect in a REST client or curl. A basic HTML admin page is a near-term improvement but not a blocker.

---

## 8. Open Questions and Deferred Decisions

**Schema approach for new domains**

The choice between runtime Prisma migrations (Approach A), the universal QueryResult envelope (Approach B), and a pre-provisioned fixed schema (Approach C) is the most consequential near-term decision. It affects the registration step, the ScrapeProvider, and the long-term database shape. Approach C is recommended but needs explicit sign-off.

**DataSource vs sources array**

Should `DataSource` be a standalone database model as specified here, or should the existing `sources` array on `DomainConfig` be extended? The standalone model is cleaner for independent source management but requires a migration and more code. The extended array is simpler but makes per-source lifecycle management harder. This document recommends the standalone model but the decision should be made before the registration step is built.

**Approval automation threshold**

At what confidence score should a discovery record be auto-approved without human review? Currently all records require human review. A threshold — say, confidence > 0.9 from a known-good source type like a government REST API — could allow automatic registration for low-risk sources. This has safety implications and should be decided deliberately.

**Composite domain handling**

When a query spans multiple domains — "is this area safe to live in?" combining crime, air quality, and housing — should the result be stored as a composite snapshot or as separate domain snapshots linked by a query ID? Phase 10 describes composite intents but the storage model is not specified. This decision should be made before Phase 10 work proceeds.

**Cinema listings location routing**

The Odeon source URL is `https://www.odeon.co.uk/cinemas/{location}/` where `{location}` is a cinema-specific slug like `braehead`. The geocoder returns a place name, not an Odeon slug. A mapping from place names to cinema slugs is needed. This could be a static lookup table per source, a separate API call to the cinema's own search endpoint, or a Stagehand step that finds the right cinema page from the cinema chain's listing page. This is a source-specific routing problem that the `DataSource` model needs to accommodate.

**The bot detection question**

miniTest.ts demonstrated that Odeon's website is accessible to Stagehand in LOCAL mode without Cloudflare blocking. This may be because the accessibility tree snapshot approach does not trigger the same fingerprinting checks as a full browser render. This should not be assumed to hold for all commercial websites — Browserbase remains the correct long-term solution for sites with active bot detection.

---

## 9. Recommended Build Order

Given the dependencies between the pieces described in this document, the recommended build order is:

1. **`proposeDomainConfig` ephemeral fields** — Extend the LLM prompt to return `storeResults`, `refreshPolicy`, and `ephemeralRationale` in the proposed config. Update the `DomainDiscovery` record to store these fields. This must come first — every subsequent step depends on `storeResults` being present in the proposed config.

2. **DataSource model** — Add the Prisma model, migration, and loading logic. Required before the registration step can write anything useful.

3. **Admin approval endpoint** — `GET /admin/discovery`, `POST /admin/discovery/:id/approve` (with overrides support), and `POST /admin/discovery/:id/reject`. The approve endpoint applies overrides and triggers the registration step.

4. **Registration step — ephemeral path** — The simpler branch: validate config, create `DataSource` record, register fetch-and-discard adapter, no table creation. Build and test this before the persistent path.

5. **Registration step — persistent path** — Create domain using pre-provisioned Approach C schema, link `DataSource`, register full `GenericAdapter` with storage.

6. **Execute pipeline ephemeral bypass** — When the matched adapter has `storeResults: false`, skip cache write, skip snapshot creation, skip result table write. Return results directly.

7. **ScrapeProvider** — Add `type: "scrape"` to the provider system. Wire into `GenericAdapter` and `sampleSource`. Use the miniTest.ts Stagehand pattern.

8. **Curated source registry** — Add the registry as a TypeScript array. Wire into the query pipeline between the registered adapter lookup and the discovery pipeline. Seed it with cinema chains and a handful of other well-known sources.

9. **Source-level URL routing** — Add location routing support to `DataSource` for sources that require location-specific URL slugs.

10. **Frontend ephemeral label** — Show "Live data · not saved" label, suppress workspace save and export for ephemeral results.

Each step should follow the TDD cycle established in the project: tests first, implementation to pass, stop for test run before proceeding. Steps 4 and 5 can be built incrementally — the ephemeral path is fully testable before the persistent path exists.
