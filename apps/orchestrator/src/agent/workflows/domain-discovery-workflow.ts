import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

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
}

// ── Step 1: Discover candidate sources ───────────────────────────────────────

export async function discoverSources(
  intent: string,
  country_code: string,
): Promise<DiscoveredSource[]> {
  const stagehand = new Stagehand({
    env: "LOCAL",
    model: {
      modelName: "google/gemini-2.5-flash-lite",
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    },
    localBrowserLaunchOptions: { headless: true },
  });

  try {
    await stagehand.init();

    const searchQuery = `${intent} open data ${country_code} government API CSV download site:data.gov.uk OR site:opendata.gov OR site:kaggle.com`;
    await stagehand.page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
    );

    const results = await stagehand.extract(
      `Find up to 5 public data sources that provide ${intent} data for country ${country_code}.
       Look for government open data portals, CSV files, REST APIs, or statistical datasets.
       Return the direct URL to the data, the likely format, and a brief description.`,
      z.object({
        sources: z.array(
          z.object({
            url: z.string(),
            format: z.enum(["rest", "csv", "xlsx", "scrape"]),
            description: z.string(),
            confidence: z.number().min(0).max(1),
          }),
        ),
      }),
    );

    return results.sources ?? [];
  } catch (err) {
    console.error(
      JSON.stringify({ event: "discover_sources_error", error: String(err) }),
    );
    return [];
  } finally {
    await stagehand.close();
  }
}

// ── Step 2: Sample a source ───────────────────────────────────────────────────

export async function sampleSource(url: string): Promise<{
  rows: unknown[];
  format: "rest" | "csv" | "xlsx";
} | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const data = await res.json();
      const rows = Array.isArray(data) ? data.slice(0, 5) : [data];
      return { rows, format: "rest" };
    }

    if (contentType.includes("text/csv") || url.endsWith(".csv")) {
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

Return only JSON in this exact shape:
{
  "name": "domain-name",
  "fieldMap": { "source_field": "standard_field" },
  "confidence": 0.8
}`;

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
    };
  } catch (err) {
    console.error(
      JSON.stringify({ event: "propose_config_error", error: String(err) }),
    );
    return null;
  }
}
