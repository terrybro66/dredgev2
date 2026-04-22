import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

interface InsightStats {
  totalCount: number;
  topCategory: string;
  location: string;
  dateFrom: string;
  dateTo: string;
  monthlyTrend: { month: string; count: number }[] | null;
}

function buildStats(
  rows: Record<string, unknown>[],
  plan: { category: string; date_from: string; date_to: string; location: string },
): InsightStats {
  const byCategory: Record<string, number> = {};
  const byMonth: Record<string, number> = {};

  for (const row of rows) {
    const cat = (row.category as string) ?? "unknown";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;

    const d = row.date ?? row.month;
    let monthStr: string | null = null;
    if (d instanceof Date) {
      monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    } else if (typeof d === "string" && d.length >= 7) {
      monthStr = d.slice(0, 7);
    }
    if (monthStr) {
      byMonth[monthStr] = (byMonth[monthStr] ?? 0) + 1;
    }
  }

  const topCategory =
    Object.entries(byCategory).sort(([, a], [, b]) => b - a)[0]?.[0] ?? plan.category;

  const monthlyTrend =
    plan.date_from !== plan.date_to
      ? Object.entries(byMonth)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, count]) => ({ month, count }))
      : null;

  return {
    totalCount: rows.length,
    topCategory,
    location: plan.location,
    dateFrom: plan.date_from,
    dateTo: plan.date_to,
    monthlyTrend,
  };
}

// ── Domain display names for prompts ─────────────────────────────────────────

const DOMAIN_DISPLAY: Record<string, string> = {
  "crime-uk":        "crime incidents",
  "weather":         "weather conditions",
  "cinemas-gb":      "cinemas",
  "food-hygiene-gb": "food hygiene ratings",
  "flood-risk-gb":   "flood risk zones",
};

function domainDisplay(domain: string): string {
  return DOMAIN_DISPLAY[domain] ?? domain.replace(/-/g, " ");
}

/**
 * Generate a one-sentence natural language insight for a single domain result.
 * Works for any registered domain — not just crime.
 * Returns null when rows are empty or the LLM call fails.
 */
export async function generateInsight(
  rows: Record<string, unknown>[],
  plan: { category: string; date_from: string; date_to: string; location: string },
  domain: string,
): Promise<string | null> {
  if (rows.length === 0) return null;

  const stats = buildStats(rows, plan);
  const domainLabel = domainDisplay(domain);

  const trendNote =
    stats.monthlyTrend && stats.monthlyTrend.length >= 2
      ? `Monthly counts: ${stats.monthlyTrend.map((m) => `${m.month}: ${m.count}`).join(", ")}.`
      : "";

  const prompt = `You are a public data analyst. Write exactly one factual sentence (under 30 words) summarising these ${domainLabel} statistics for a UK resident. No markdown, no quotes.

Total records: ${stats.totalCount}
Most common category: ${stats.topCategory}
Location: ${stats.location}
${plan.date_from !== plan.date_to ? `Period: ${stats.dateFrom} to ${stats.dateTo}` : ""}
${trendNote}

Summary sentence:`;

  try {
    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      max_tokens: 60,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.choices[0]?.message?.content?.trim() ?? null;
    console.log(JSON.stringify({ event: "insight_generated", domain, count: rows.length }));
    return text || null;
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "insight_generation_failed",
        domain,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

// ── Stack synthesis ───────────────────────────────────────────────────────────

export interface StackEntry {
  domain: string;
  rows: Record<string, unknown>[];
  vizHint: string;
}

/**
 * Synthesise a cross-domain conclusion from two or more stacked results.
 *
 * Takes the primary domain result + all chip follow-up results, builds a
 * concise data summary for each, then asks the LLM to draw a conclusion that
 * directly answers the user's implicit question (is this a good area to live?
 * where should I eat tonight? which site makes sense?).
 *
 * Returns null if the LLM call fails — callers should treat null as
 * "synthesis unavailable, show individual insights instead."
 */
export async function synthesiseStack(
  stack: StackEntry[],
  location: string,
): Promise<string | null> {
  if (stack.length < 2) return null;

  // Build a plain-English data summary for each domain in the stack
  const domainSummaries = stack.map((entry) => {
    const label = domainDisplay(entry.domain);
    const count = entry.rows.length;
    if (count === 0) return `${label}: no data found for this area`;

    const byCategory: Record<string, number> = {};
    for (const row of entry.rows) {
      const cat = (row.category as string) ?? "unknown";
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }
    const topCat = Object.entries(byCategory).sort(([, a], [, b]) => b - a)[0]?.[0];
    return topCat && topCat !== "unknown"
      ? `${label}: ${count} records, most common category "${topCat}"`
      : `${label}: ${count} records`;
  });

  // Infer the user's question from the domain combination
  const domains = stack.map((e) => e.domain);
  const question = inferUserQuestion(domains, location);

  const prompt = `You are a UK public data analyst helping a resident make an informed decision about ${location}.

The user has gathered data from multiple sources:
${domainSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Their implicit question: ${question}

Write 2–3 sentences that directly answer their question using the data above. Be specific and concrete — mention actual numbers where relevant. End with a clear recommendation or conclusion. No markdown, no bullet points.`;

  try {
    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      max_tokens: 120,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.choices[0]?.message?.content?.trim() ?? null;
    console.log(
      JSON.stringify({
        event: "synthesis_generated",
        location,
        domains,
        count: stack.length,
      }),
    );
    return text || null;
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "synthesis_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

/**
 * Infer the user's underlying question from the combination of domains they've
 * navigated. This anchors the synthesis prompt to the right user story.
 */
function inferUserQuestion(domains: string[], location: string): string {
  const has = (d: string) => domains.some((x) => x === d || x.startsWith(d));

  if (has("crime-uk") && has("flood-risk-gb") && has("food-hygiene-gb")) {
    return `Is ${location} a good place to live or buy property?`;
  }
  if (has("cinemas-gb") && has("weather") && has("food-hygiene-gb")) {
    return `Where and when should I go out in ${location} this weekend?`;
  }
  if (has("crime-uk") && has("flood-risk-gb")) {
    return `How safe is ${location} from crime and flooding?`;
  }
  if (has("cinemas-gb") && has("food-hygiene-gb")) {
    return `Which venues near cinemas in ${location} are worth visiting?`;
  }
  if (has("crime-uk") && has("food-hygiene-gb")) {
    return `What is the overall safety and food quality picture in ${location}?`;
  }
  if (has("cinemas-gb") && has("crime-uk")) {
    return `Is it safe to go out to the cinema in ${location}?`;
  }
  // Generic fallback
  return `What does the combined data tell a resident or visitor about ${location}?`;
}

/**
 * Generate an insight along with suggested follow‑up queries that form a logical progression.
 * Returns an object containing the insight (or null) and an array of follow‑up suggestions.
 * The follow‑ups are derived from patterns in the data (e.g., trends, location, categories).
 */
export async function generateInsightWithFollowUps(
  rows: Record<string, unknown>[],
  plan: { category: string; date_from: string; date_to: string; location: string },
  domain: string,
): Promise<{ insight: string | null; followUps: Array<{ label: string; intent: string; params: Record<string, unknown> }> }> {
  const insight = await generateInsight(rows, plan, domain);
  const followUps: Array<{ label: string; intent: string; params: Record<string, unknown> }> = [];

  if (rows.length === 0) {
    return { insight, followUps };
  }

  const stats = buildStats(rows, plan);

  // Suggest a follow‑up to compare with a nearby location
  followUps.push({
    label: `Compare with nearby areas`,
    intent: `compare_${plan.category}`,
    params: {
      location: plan.location,
      radius: 10,
      date_from: plan.date_from,
      date_to: plan.date_to,
    },
  });

  // If there's a monthly trend, suggest drilling into a specific month
  if (stats.monthlyTrend && stats.monthlyTrend.length >= 2) {
    const highestMonth = stats.monthlyTrend.reduce((prev, curr) => (curr.count > prev.count ? curr : prev));
    followUps.push({
      label: `See details for ${highestMonth.month}`,
      intent: `drill_down`,
      params: {
        date_from: highestMonth.month + "-01",
        date_to: highestMonth.month + "-31",
        category: plan.category,
        location: plan.location,
      },
    });
  }

  // Suggest a related domain (e.g., from crime to safety scores)
  if (domain.startsWith("crime")) {
    followUps.push({
      label: `Check safety scores for ${plan.location}`,
      intent: `safety_scores`,
      params: {
        location: plan.location,
        date_from: plan.date_from,
        date_to: plan.date_to,
      },
    });
  }

  return { insight, followUps };
}
