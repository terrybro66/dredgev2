import { StagehandCrawler } from "@crawlee/stagehand";
import { z } from "zod";
import { searchWithSerp } from "../search/serp";
import { searchCatalogue } from "../search/catalogue";

export interface CandidateSource {
  url: string;
  formatHint: "rest" | "csv" | "xlsx" | "scrape";
  confidence: number;
  description: string;
}

// ── Step 1: Search for alternative sources ────────────────────────────────────
//
// Priority:
//   1. data.gov.uk catalogue (GB only, fast, no browser)
//   2. SerpAPI (structured, no browser)
//   3. StagehandCrawler + Bing (browser fallback)

export async function searchAlternativeSources(
  intent: string,
  location: string,
  country_code: string,
  date_range: string,
): Promise<CandidateSource[]> {
  // 1 — catalogue
  const catalogueResults = await searchCatalogue(intent, country_code);
  if (catalogueResults.length > 0) {
    console.log(
      JSON.stringify({
        event: "shadow_catalogue_hit",
        intent,
        country_code,
        count: catalogueResults.length,
      }),
    );
    return catalogueResults.map((r) => ({
      url: r.url,
      formatHint: r.format,
      confidence: r.confidence,
      description: r.description,
    }));
  }

  // 2 — SerpAPI (include location in query for shadow recovery)
  const serpResults = await searchWithSerp(`${intent} ${location}`, country_code);
  if (serpResults.length > 0) {
    console.log(
      JSON.stringify({
        event: "shadow_serp_hit",
        intent,
        country_code,
        count: serpResults.length,
      }),
    );
    return serpResults.map((r) => ({
      url: r.url,
      formatHint: r.format,
      confidence: r.confidence,
      description: r.description,
    }));
  }

  // 3 — StagehandCrawler browser fallback
  console.log(
    JSON.stringify({ event: "shadow_browser_fallback", intent, country_code }),
  );
  return searchWithBrowser(intent, location, country_code);
}

async function searchWithBrowser(
  intent: string,
  location: string,
  country_code: string,
): Promise<CandidateSource[]> {
  const sources: CandidateSource[] = [];

  const crawler = new StagehandCrawler({
    stagehandOptions: {
      env: "LOCAL" as const,
      model: "openai/gpt-4.1-mini",
      apiKey: process.env.OPENROUTER_API_KEY,
    },
    maxRequestsPerCrawl: 1,
    async requestHandler({ page, log }) {
      log.info(`Shadow searching for: ${intent} in ${location}`);
      try {
        const results = await page.extract(
          `Extract up to 5 public data source URLs that could provide ${intent} data for ${location}.
           Look for government open data portals, CSV downloads, REST APIs, or data repositories.
           For each result extract the URL and guess the format (rest, csv, xlsx, or scrape).`,
          z.object({
            sources: z.array(
              z.object({
                url: z.string(),
                formatHint: z.enum(["rest", "csv", "xlsx", "scrape"]),
                confidence: z.number().min(0).max(1),
                description: z.string(),
              }),
            ),
          }),
        );
        sources.push(...(results.sources ?? []));
      } catch (err) {
        log.error(`Shadow stagehand extract failed: ${String(err)}`);
      }
    },
  });

  const searchQuery = `${intent} data ${location} ${country_code} open data CSV API download`;
  try {
    await crawler.run([
      `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}`,
    ]);
  } catch (err) {
    console.error(
      JSON.stringify({ event: "shadow_crawl_error", error: String(err) }),
    );
  }

  return sources;
}

// ── Step 2: Sample and detect format ─────────────────────────────────────────

export async function sampleAndDetectFormat(url: string): Promise<{
  rows: unknown[];
  format: "rest" | "csv" | "xlsx" | "scrape";
  sampleSize: number;
} | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const data = await res.json();
      const rows = Array.isArray(data) ? data.slice(0, 10) : [data];
      return { rows, format: "rest", sampleSize: rows.length };
    }

    if (contentType.includes("text/csv") || url.endsWith(".csv")) {
      const text = await res.text();
      const lines = text.split("\n").filter(Boolean).slice(0, 11);
      const headers = lines[0].split(",");
      const rows = lines.slice(1).map((line) => {
        const vals = line.split(",");
        return Object.fromEntries(
          headers.map((h, i) => [h.trim(), vals[i]?.trim()]),
        );
      });
      return { rows, format: "csv", sampleSize: rows.length };
    }

    return null;
  } catch {
    return null;
  }
}
