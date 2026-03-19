import type { DiscoveredSource } from "../workflows/domain-discovery-workflow";

function inferFormat(url: string): DiscoveredSource["format"] {
  const lower = url.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
  if (lower.endsWith(".json") || lower.includes("/api/")) return "rest";
  return "scrape";
}

export async function searchWithSerp(
  intent: string,
  country_code: string,
): Promise<DiscoveredSource[]> {
  const apiKey = process.env.SERAPI_KEY;
  if (!apiKey) {
    console.warn(JSON.stringify({ event: "serp_disabled", reason: "SERAPI_KEY not set" }));
    return [];
  }

  const query = `${intent} open data ${country_code} government dataset CSV API`;
  const url =
    `https://serpapi.com/search.json` +
    `?q=${encodeURIComponent(query).replace(/%20/g, "+")}` +
    `&api_key=${apiKey}` +
    `&num=5` +
    `&gl=${country_code.toLowerCase()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(JSON.stringify({ event: "serp_error", status: res.status }));
      return [];
    }

    const data = (await res.json()) as any;
    const organic: any[] = data.organic_results ?? [];

    return organic.map((r) => ({
      url: r.link as string,
      format: inferFormat(r.link as string),
      description: (r.snippet ?? r.title ?? "") as string,
      confidence: 0.5,
    }));
  } catch (err) {
    console.error(JSON.stringify({ event: "serp_fetch_error", error: String(err) }));
    return [];
  }
}
