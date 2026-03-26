import type { DiscoveredSource } from "../workflows/domain-discovery-workflow";

const CATALOGUE_API = "https://data.gov.uk/api/3/action/package_search";

// Only GB is supported via data.gov.uk — extend this map for other catalogues
const CATALOGUE_BY_COUNTRY: Record<string, string> = {
  GB: CATALOGUE_API,
};

function inferFormat(format: string): DiscoveredSource["format"] {
  const f = format.toUpperCase();
  if (f === "CSV") return "csv";
  if (f === "XLSX" || f === "XLS") return "xlsx";
  if (f === "JSON" || f === "API") return "rest";
  return "scrape";
}

export async function searchCatalogue(
  intent: string,
  country_code: string,
): Promise<DiscoveredSource[]> {
  const catalogueUrl = CATALOGUE_BY_COUNTRY[country_code.toUpperCase()];
  if (!catalogueUrl) return [];

  const url = `${catalogueUrl}?q=${encodeURIComponent(intent)}&rows=5`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        JSON.stringify({
          event: "catalogue_error",
          status: res.status,
          country_code,
        }),
      );
      return [];
    }

    const data = (await res.json()) as any;
    const datasets: any[] = data.result?.results ?? [];

    const sources: DiscoveredSource[] = [];

    for (const dataset of datasets) {
      const resources: any[] = dataset.resources ?? [];
      if (resources.length === 0) continue;

      // Use the first resource with a valid non-empty URL
      const resource = resources.find(
        (r: any) => typeof r.url === "string" && r.url.trim() !== "",
      );
      if (!resource) continue;

      // Skip URLs that are clearly stale or placeholder values
      const url = resource.url as string;
      if (
        url.includes("datapress.com") || // known stale CDN
        url.endsWith("#") ||
        url === "N/A"
      )
        continue;

      sources.push({
        url,
        format: inferFormat(resource.format ?? ""),
        description: (dataset.notes ?? dataset.title ?? "") as string,
        confidence: 0.8,
      });
    }

    console.log(
      JSON.stringify({
        event: "catalogue_search_complete",
        intent,
        country_code,
        results: sources.length,
      }),
    );

    return sources;
  } catch (err) {
    console.error(
      JSON.stringify({ event: "catalogue_fetch_error", error: String(err) }),
    );
    return [];
  }
}
