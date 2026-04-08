import type { DiscoveredSource } from "../workflows/domain-discovery-workflow";

const CATALOGUE_API = "https://data.gov.uk/api/3/action/package_search";

// Only GB is supported via data.gov.uk — extend this map for other catalogues
const CATALOGUE_BY_COUNTRY: Record<string, string> = {
  GB: CATALOGUE_API,
};

/**
 * Extracts meaningful keywords from an intent string (words > 2 chars).
 */
function intentKeywords(intent: string): string[] {
  return intent
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Returns true if the dataset title or description contains at least one
 * intent keyword. This is a necessary but not sufficient condition —
 * a dataset titled "local listings" matches "cinema listings" even if
 * its resource URL points to vets data.
 */
function metadataRelevant(
  keywords: string[],
  title: string,
  notes: string,
): boolean {
  const haystack = `${title} ${notes}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw));
}

/**
 * Returns true if the resource URL path does NOT contain words that are
 * clearly unrelated to the intent AND contains no intent keyword.
 *
 * A URL like /localpublicdata/vets has "vets" in the path but no intent
 * keyword ("cinema", "listings") — it fails this check.
 *
 * A URL that has no intent keyword but also no obviously irrelevant path
 * segment passes (benefit of the doubt — the URL path isn't always
 * descriptive, e.g. /api/v1/data.csv).
 */
function urlRelevant(keywords: string[], url: string): boolean {
  const path = url.toLowerCase();
  // If any intent keyword appears in the URL, it's definitely relevant
  if (keywords.some((kw) => path.includes(kw))) return true;
  // If the URL path contains a segment that contradicts the intent, reject it
  // Extract path segments after the domain
  try {
    const { pathname } = new URL(url);
    const segments = pathname.toLowerCase().split("/").filter(Boolean);
    // A segment is "contradicting" if it has no overlap with intent keywords
    // AND the full URL has no intent keyword AND the segment is a meaningful word
    // Use a simple heuristic: if the last meaningful segment looks like a
    // completely different domain concept, flag it
    const lastSegment = segments[segments.length - 1] ?? "";
    // Known-bad patterns for common intents — extend as needed
    const IRRELEVANT_SEGMENTS = new Set([
      "vets",
      "veterinary",
      "planning",
      "recycling",
      "bins",
      "parking",
      "allotments",
      "cemeteries",
      "toilets",
      "housing",
      "benefits",
    ]);
    if (IRRELEVANT_SEGMENTS.has(lastSegment)) return false;
  } catch {
    // Not a valid URL — let it through, will fail at fetch time
  }
  return true;
}

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
    const keywords = intentKeywords(intent);

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
      if (url.includes("datapress.com") || url.endsWith("#") || url === "N/A")
        continue;

      if (inferFormat(resource.format ?? "") === "scrape") continue;

      // Skip datasets with no topical relevance to the intent (metadata check)
      const title = (dataset.title ?? "") as string;
      const notes = (dataset.notes ?? "") as string;
      const urlHasKeyword = keywords.some((kw) =>
        url.toLowerCase().includes(kw),
      );

      if (!metadataRelevant(keywords, title, notes) && !urlHasKeyword) {
        console.log(
          JSON.stringify({ event: "catalogue_filtered_metadata", url, title }),
        );
        continue;
      }

      // Skip datasets whose resource URL contradicts the intent (URL check)
      if (!urlRelevant(keywords, url)) {
        console.log(
          JSON.stringify({ event: "catalogue_filtered_url", url, title }),
        );
        continue;
      }

      console.log(JSON.stringify({ event: "catalogue_accepted", url, title }));
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
