import { Stagehand, AISdkClient } from "@browserbasehq/stagehand";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export interface CandidateSource {
  url: string;
  formatHint: "rest" | "csv" | "xlsx" | "scrape";
  confidence: number;
  description: string;
}

export async function searchAlternativeSources(
  intent: string,
  location: string,
  country_code: string,
  date_range: string,
): Promise<CandidateSource[]> {
  const stagehand = new Stagehand({
    env: "LOCAL",
    llmClient: new AISdkClient({
      model: openrouter("google/gemini-2.5-flash-lite"),
    }),
    localBrowserLaunchOptions: { headless: true },
  });

  try {
    await stagehand.init();

    const searchQuery = `${intent} data ${location} ${country_code} open data CSV API download`;
    const page = await (stagehand as any).resolvePage();
    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
    );
    const results = await stagehand.extract(
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
      }) as any,
    );
    return results.sources ?? [];
  } catch (err) {
    console.error(
      JSON.stringify({ event: "shadow_search_error", error: String(err) }),
    );
    return [];
  } finally {
    await stagehand.close();
  }
}

export async function sampleAndDetectFormat(url: string): Promise<{
  rows: unknown[];
  format: "rest" | "csv" | "xlsx" | "scrape";
  sampleSize: number;
} | null> {
  try {
    // Try REST/JSON first
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
