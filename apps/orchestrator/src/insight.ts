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

/**
 * Generate a one-sentence natural language insight for a set of crime results.
 * Returns null when rows are empty, when the domain is non-crime, or when the
 * LLM call fails — callers should treat null as "no insight available".
 */
export async function generateInsight(
  rows: Record<string, unknown>[],
  plan: { category: string; date_from: string; date_to: string; location: string },
  domain: string,
): Promise<string | null> {
  if (rows.length === 0) return null;
  if (!domain.startsWith("crime")) return null;

  const stats = buildStats(rows, plan);

  const trendNote =
    stats.monthlyTrend && stats.monthlyTrend.length >= 2
      ? `Monthly counts: ${stats.monthlyTrend.map((m) => `${m.month}: ${m.count}`).join(", ")}.`
      : "";

  const prompt = `You are a UK crime data analyst. Write exactly one factual sentence (under 25 words) summarising these statistics. No markdown, no quotes.

Total incidents: ${stats.totalCount}
Most common category: ${stats.topCategory}
Location: ${stats.location}
Period: ${stats.dateFrom} to ${stats.dateTo}
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
