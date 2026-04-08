/**
 * test-serp-resolution.ts
 *
 * Manual integration test for resolveUrlForQuery.
 * Calls SerpAPI with real queries and prints the resolved URL.
 *
 * Usage:
 *   npx tsx src/scripts/test-serp-resolution.ts
 *
 * Requires SERAPI_KEY in .env
 */

import "dotenv/config";
import { resolveUrlForQuery } from "../agent/search/serp";

interface TestCase {
  label: string;
  query: string;
  preferredDomains?: string[];
  expectDomain?: string; // substring we hope to see in the result
}

const CINEMA_DOMAINS = [
  "odeon.co.uk",
  "myvue.com",
  "cineworld.co.uk",
  "picturehouses.com",
  "everymancinema.com",
];

const TEST_CASES: TestCase[] = [
  {
    label: "Named Odeon — Braehead",
    query: "cinema listings Braehead, Renfrewshire, Scotland, United Kingdom",
    preferredDomains: CINEMA_DOMAINS,
    expectDomain: "odeon.co.uk",
  },
  {
    label: "Cinema listings — Sheffield",
    query: "cinema listings Sheffield, South Yorkshire, England, United Kingdom",
    preferredDomains: CINEMA_DOMAINS,
    expectDomain: "odeon.co.uk",
  },
  {
    label: "Cinema listings — Manchester",
    query: "cinema listings Manchester, England, United Kingdom",
    preferredDomains: CINEMA_DOMAINS,
  },
  {
    label: "Cinema listings — Edinburgh",
    query: "cinema listings Edinburgh, Scotland, United Kingdom",
    preferredDomains: CINEMA_DOMAINS,
  },
  {
    label: "Boutique chain — Everyman Leeds",
    query: "cinema listings Leeds, England, United Kingdom",
    preferredDomains: CINEMA_DOMAINS,
  },
  {
    label: "Train times — Glasgow to Edinburgh",
    query: "train times Glasgow to Edinburgh",
    preferredDomains: ["scotrail.co.uk", "trainline.com", "nationalrail.co.uk"],
    expectDomain: "scotrail.co.uk",
  },
  {
    label: "Bus times — Leeds Bradford",
    query: "bus times Leeds Bradford",
    preferredDomains: ["firstbus.co.uk", "arrivabus.co.uk", "wymetro.com"],
  },
  {
    label: "Pharmacy open now — Leeds",
    query: "pharmacy open now Leeds",
    preferredDomains: [],
  },
  {
    label: "No location — falls back to country name (UK)",
    query: "cinema listings UK",
    preferredDomains: CINEMA_DOMAINS,
    expectDomain: "odeon.co.uk",
  },
];

const PASS = "✅";
const FAIL = "❌";
const WARN = "⚠️ ";

async function run() {
  if (!process.env.SERPAPI_KEY) {
    console.error("❌ SERPAPI_KEY not set in .env");
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════════");
  console.log(" resolveUrlForQuery — integration test");
  console.log("═══════════════════════════════════════════════════════\n");

  let passed = 0;
  let failed = 0;
  let warned = 0;

  for (const tc of TEST_CASES) {
    process.stdout.write(`${tc.label}\n  query: "${tc.query}"\n`);

    const url = await resolveUrlForQuery(tc.query, tc.preferredDomains ?? []);

    if (!url) {
      console.log(`  ${FAIL} No URL returned\n`);
      failed++;
      continue;
    }

    console.log(`  → ${url}`);

    if (tc.expectDomain) {
      if (url.includes(tc.expectDomain)) {
        console.log(`  ${PASS} Contains expected domain: ${tc.expectDomain}\n`);
        passed++;
      } else {
        console.log(`  ${WARN} Expected domain "${tc.expectDomain}" not found\n`);
        warned++;
      }
    } else {
      console.log(`  ${PASS} URL resolved (no domain expectation)\n`);
      passed++;
    }
  }

  console.log("═══════════════════════════════════════════════════════");
  console.log(` Results: ${passed} passed, ${warned} warned, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
