import { StagehandCrawler } from "@crawlee/stagehand";
import { z } from "zod";
import { searchWithSerp } from "../search/serp";
import { searchCatalogue } from "../search/catalogue";

export interface DiscoveredSource {
  url: string;
  format: "rest" | "csv" | "xlsx" | "scrape";
  description: string;
  confidence: number;
}

export interface ProposedDomainConfig {
  name: string;
  intent: string;
  country_code: string;
  apiUrl: string;
  providerType: "rest" | "csv" | "xlsx";
  sampleRows: unknown[];
  fieldMap: Record<string, string>;
  confidence: number;
  storeResults: boolean;
  refreshPolicy: "realtime" | "daily" | "weekly" | "static";
  ephemeralRationale: string;
  /**
   * Template type — determines which capability chips and cross-domain affinity
   * rules apply to this domain. Must be one of the six canonical templates.
   */
  templateType: "incidents" | "places" | "forecasts" | "boundaries" | "listings" | "regulations";
  coverage: {
    type: "national" | "regional" | "local" | "unknown";
    region: string | null;
    locationPolygon: { type: "Polygon"; coordinates: number[][][] } | null;
  };
}

// Direct file extensions that don't need browser resolution
const DIRECT_EXTENSIONS = [".csv", ".xlsx", ".xls", ".json", ".pdf"];

function isDirectUrl(url: string): boolean {
  const lower = url.toLowerCase().split("?")[0];
  return DIRECT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// ── Step 1: Discover candidate sources ───────────────────────────────────────
//
// Priority:
//   1. data.gov.uk catalogue API  — GB only, instant, no browser, confidence 0.8
//   2. SerpAPI                    — structured results, no browser, confidence 0.5
//   3. StagehandCrawler + Bing    — browser fallback, last resort

export async function discoverSources(
  intent: string,
  country_code: string,
): Promise<DiscoveredSource[]> {
  // 1 — catalogue
  const catalogueResults = await searchCatalogue(intent, country_code);
  if (catalogueResults.length > 0) {
    console.log(
      JSON.stringify({
        event: "discover_sources_catalogue_hit",
        intent,
        country_code,
        count: catalogueResults.length,
      }),
    );
    return catalogueResults;
  }

  // 2 — SerpAPI
  const serpResults = await searchWithSerp(intent, country_code);
  if (serpResults.length > 0) {
    console.log(
      JSON.stringify({
        event: "discover_sources_serp_hit",
        intent,
        country_code,
        count: serpResults.length,
      }),
    );
    return serpResults;
  }

  // 3 — StagehandCrawler browser fallback
  console.log(
    JSON.stringify({
      event: "discover_sources_browser_fallback",
      intent,
      country_code,
    }),
  );
  return discoverWithBrowser(intent, country_code);
}

async function discoverWithBrowser(
  intent: string,
  country_code: string,
): Promise<DiscoveredSource[]> {
  const sources: DiscoveredSource[] = [];

  const crawler = new StagehandCrawler({
    stagehandOptions: {
      env: "LOCAL" as const,
      model: {
        modelName: "openai/gpt-4o-mini",
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
      },
    },
    maxRequestsPerCrawl: 1,
    async requestHandler({ page, log }) {
      log.info(`Discovering sources for: ${intent} (${country_code})`);
      try {
        const results = await page.extract(
          `Find up to 5 public data sources that provide "${intent}" data for country "${country_code}".
           Look for government open data portals, REST APIs, CSV file downloads, or statistical datasets.
           For each source found, return the REAL URL (not null, not placeholder), its format, and a description.
           If you cannot find any real data sources, return an empty items array: {"items": []}.
           Do NOT return null or placeholder values — omit entries where the URL is unknown.`,
          z.object({
            items: z.array(
              z.object({
                url: z.string().url(),
                format: z.enum(["rest", "csv", "xlsx", "scrape"]),
                description: z.string().min(1),
                confidence: z.number().min(0).max(1),
              }),
            ),
          }),
        );
        // Filter out any entries that slipped through with null-like values
        const valid = (results.items ?? []).filter(
          (s) => s.url && s.url !== "null" && s.description && s.description !== "null",
        );
        sources.push(...valid);
      } catch (err) {
        log.error(`Stagehand extract failed: ${String(err)}`);
      }
    },
  });

  const searchQuery = `${intent} open data ${country_code} government dataset filetype:csv OR filetype:json`;
  try {
    await crawler.run([
      `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}`,
    ]);
  } catch (err) {
    console.error(
      JSON.stringify({ event: "browser_crawl_error", error: String(err) }),
    );
  }

  return sources;
}

// ── resolveDirectDownloadUrl ──────────────────────────────────────────────────
//
// Some discovered URLs point to a dataset landing page rather than a direct
// file. This function detects HTML pages and uses StagehandCrawler to extract
// the actual download link, then returns it. Direct file URLs are returned
// unchanged without launching a browser.

export async function resolveDirectDownloadUrl(url: string): Promise<string> {
  if (isDirectUrl(url)) return url;

  let resolved = url;

  const crawler = new StagehandCrawler({
    stagehandOptions: {
      env: "LOCAL" as const,
      model: {
        modelName: "openai/gpt-4o-mini",
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
      },
    },
    maxRequestsPerCrawl: 1,
    async requestHandler({ page, log }) {
      log.info(`Resolving download URL from: ${url}`);
      try {
        const result = await page.extract(
          `Find the direct download URL for a data file (CSV, JSON, XLSX, or PDF) on this page.
           Return null if no direct download link is found.`,
          z.object({
            downloadUrl: z.string().nullable(),
          }),
        );
        if (result.downloadUrl) {
          resolved = result.downloadUrl;
        }
      } catch (err) {
        log.error(`Failed to resolve download URL: ${String(err)}`);
      }
    },
  });

  try {
    await crawler.run([url]);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "resolve_url_crawl_error",
        url,
        error: String(err),
      }),
    );
  }

  return resolved;
}

// ── Step 2: Sample a source ───────────────────────────────────────────────────

export async function sampleSource(url: string): Promise<{
  rows: unknown[];
  format: "rest" | "csv" | "xlsx";
} | null> {
  // Resolve indirect URLs before attempting to fetch
  const directUrl = await resolveDirectDownloadUrl(url);

  try {
    const res = await fetch(directUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const data = await res.json();
      const rows = Array.isArray(data) ? data.slice(0, 5) : [data];
      return { rows, format: "rest" };
    }

    if (contentType.includes("text/csv") || directUrl.endsWith(".csv")) {
      const text = await res.text();
      const lines = text.split("\n").filter(Boolean).slice(0, 6);
      if (lines.length < 2) return null;
      const headers = lines[0]
        .split(",")
        .map((h) => h.trim().replace(/"/g, ""));
      const rows = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim().replace(/"/g, ""));
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
      });
      return { rows, format: "csv" };
    }

    return null;
  } catch {
    return null;
  }
}

// ── Step 3: Propose domain config via LLM ────────────────────────────────────

export async function proposeDomainConfig(
  intent: string,
  country_code: string,
  source: DiscoveredSource,
  sampleRows: unknown[],
): Promise<ProposedDomainConfig | null> {
  try {
    const prompt = `You are a data engineer. Given sample rows from a public data source, propose a domain configuration.

Intent: ${intent}
Country: ${country_code}
Source URL: ${source.url}
Source description: ${source.description}
Sample rows: ${JSON.stringify(sampleRows.slice(0, 3), null, 2)}

Propose:
1. A domain name (kebab-case, e.g. "flood-risk-uk")
2. A field mapping from source field names to standard names (date, location, value, description, lat, lon)
3. A confidence score 0-1
4. Whether results should be stored persistently (storeResults: true) or discarded after delivery (storeResults: false).
   Set storeResults: false for live or time-sensitive data that changes constantly and has no value being stored
   (e.g. cinema showtimes, live transport, current prices). Set storeResults: true for stable civic or reference
   data that benefits from caching and history (e.g. crime statistics, flood risk, planning applications).
5. A refresh policy: "realtime" (fetch live, never cache), "daily", "weekly", or "static" (never changes).
6. A brief rationale explaining the storeResults decision (ephemeralRationale).
7. The template type — choose exactly one based on what this data represents:
   - "incidents": time-stamped events with location (crimes, accidents, planning applications, complaints)
   - "places": fixed named locations with category (cinemas, hospitals, parks, stations)
   - "forecasts": time-series values at a point (weather, air quality, tidal levels, traffic counts)
   - "boundaries": geographic zones or areas (flood zones, conservation areas, electoral wards)
   - "listings": businesses or services with ratings/scores (food hygiene, reviews, company registrations)
   - "regulations": eligibility rules or licence conditions (permits, qualifications, legal requirements)
8. Geographic coverage of this data source:
   - "national": covers the entire country (e.g. UK-wide crime statistics)
   - "regional": covers a specific region or county — provide the region name (e.g. "East of England")
   - "local": specific to one city or small area — provide a GeoJSON Polygon if you can infer one from the URL/description
   - "unknown": cannot determine coverage from the available information

Return only JSON in this exact shape:
{
  "name": "domain-name",
  "fieldMap": { "source_field": "standard_field" },
  "confidence": 0.8,
  "storeResults": true,
  "refreshPolicy": "weekly",
  "ephemeralRationale": "Crime statistics are stable reference data.",
  "templateType": "incidents",
  "coverage": {
    "type": "national",
    "region": null,
    "locationPolygon": null
  }
}
`;

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://dredge.local",
        "X-OpenRouter-Title": "DREDGE",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    const data = (await res.json()) as any;
    const text = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());

    const validTemplateTypes = ["incidents", "places", "forecasts", "boundaries", "listings", "regulations"];
    const templateType = validTemplateTypes.includes(parsed.templateType)
      ? parsed.templateType
      : "listings";

    return {
      name:
        parsed.name ??
        `${intent.toLowerCase().replace(/\s+/g, "-")}-${country_code.toLowerCase()}`,
      intent,
      country_code,
      apiUrl: source.url,
      providerType: source.format === "scrape" ? "rest" : source.format,
      sampleRows,
      fieldMap: parsed.fieldMap ?? {},
      confidence: parsed.confidence ?? 0.5,
      storeResults: parsed.storeResults ?? true,
      refreshPolicy: parsed.refreshPolicy ?? "weekly",
      ephemeralRationale: parsed.ephemeralRationale ?? "",
      templateType,
      coverage: {
        type: parsed.coverage?.type ?? "unknown",
        region: parsed.coverage?.region ?? null,
        locationPolygon: parsed.coverage?.locationPolygon ?? null,
      },
    };
  } catch (err) {
    console.error(
      JSON.stringify({ event: "propose_config_error", error: String(err) }),
    );
    return null;
  }
}
