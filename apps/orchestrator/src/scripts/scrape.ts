// mini-stagehand-agent.ts
import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

// ── SerpAPI Search ─────────────────────────────────────────────────────────

async function searchWithSerp(
  query: string,
  country_code: string,
): Promise<string[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.warn("⚠️ SERPAPI_KEY not set — skipping search");
    return [];
  }

  const url =
    `https://serpapi.com/search.json` +
    `?q=${encodeURIComponent(query).replace(/%20/g, "+")}` +
    `&api_key=${apiKey}` +
    `&num=5` +
    `&gl=${country_code.toLowerCase()}`;

  console.log(`\n🔍 SerpAPI query: "${query}"`);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`SerpAPI error: ${res.status}`);
      return [];
    }

    const data = (await res.json()) as any;
    const urls = (data.organic_results ?? []).map((r: any) => r.link as string);

    console.log(`   Found ${urls.length} results:`);
    urls.forEach((u: string, i: number) => console.log(`   ${i + 1}. ${u}`));

    return urls;
  } catch (error) {
    console.error(`SerpAPI request failed: ${error}`);
    return [];
  }
}

// ── Pick Best URL ──────────────────────────────────────────────────────────

function pickBestUrl(
  urls: string[],
  preferredDomains: string[] = [],
): string | null {
  for (const domain of preferredDomains) {
    const match = urls.find((u) => u.includes(domain));
    if (match) {
      console.log(`\n✅ Preferred domain match: ${match}`);
      return match;
    }
  }

  const first = urls[0] ?? null;
  if (first) console.log(`\n📌 Using first result: ${first}`);
  return first;
}

// ── Resolver + Extractor ───────────────────────────────────────────────────

async function resolveAndExtract(
  stagehand: Stagehand,
  page: any,
  input: string,
) {
  let targetUrl = input.trim();

  // Detect if input is a URL
  const isUrl = (() => {
    try {
      new URL(targetUrl);
      return true;
    } catch {
      return false;
    }
  })();

  // ── If query → search ───────────────────────────────────────
  if (!isUrl) {
    console.log(`\n🧠 Treating as search query: "${targetUrl}"`);

    const results = await searchWithSerp(targetUrl, "uk");

    const best = pickBestUrl(results, [
      "odeon.co.uk",
      "vuecinemas.com",
      "cineworld.co.uk",
    ]);

    if (!best) {
      console.warn("⚠️ No usable search results");
      return null;
    }

    targetUrl = best;
  }

  // ── Navigate ────────────────────────────────────────────────
  console.log(`\n🌐 Navigating to: ${targetUrl}`);

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeoutMs: 60000,
  });

  // ✅ Important: wait for dynamic content (cinema pages need this)
  await page.waitForSelector("body", { timeout: 10000 });
  await page.waitForTimeout(4000);

  // ── Extract cinema listings ─────────────────────────────────
  const result = await stagehand.extract(
    "Find all movie titles currently showing on this cinema page. Look for film listings, showtimes, or posters. Return ALL titles.",
    z.object({
      cinema: z.string().nullable(),
      movies: z.array(z.string()),
    }),
    { page },
  );

  console.log("\n🎬 Extraction result:");
  console.log(JSON.stringify(result, null, 2));

  return result;
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log(" Stagehand LOCAL + OpenRouter + SerpAPI");
  console.log("═══════════════════════════════════════════════\n");

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required");
  }

  // ── Stagehand (LOCAL mode) ──────────────────────────────────
  const stagehand = new Stagehand({
    env: "LOCAL",
    model: {
      // ✅ FIXED MODEL (works with OpenRouter)
      modelName: "openai/gpt-4o-mini",
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    },
    localBrowserLaunchOptions: {
      headless: false, // set to true in CI
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
    verbose: 2,
  });

  try {
    console.log("→ init()");
    await stagehand.init();

    let [page] = stagehand.context.pages();
    if (!page) {
      page = await stagehand.context.newPage();
    }

    // ── Run your query ────────────────────────────────────────
    const result = await resolveAndExtract(
      stagehand,
      page,
      "what's on at Odeon Braehead",
    );

    console.log("\n════════ FINAL RESULT ════════");
    console.log(result);
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    console.log("\n→ close()");
    await stagehand.close().catch(() => {});
  }
}

main();
