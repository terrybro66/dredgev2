import OpenAI from "openai";
import { QueryPlanSchema, QueryPlan, VizHint } from "@dredge/schemas";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

function buildSystemPrompt(): string {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`;

  return `You are a structured data extraction assistant. Extract the user's crime query intent and return ONLY a valid JSON object — no prose, no markdown fences.

Today is ${now.toISOString().slice(0, 10)}. The last full calendar month is ${lastMonthStr}.

Return exactly this shape:
{
  "category": "<slug>",
  "date_from": "YYYY-MM",
  "date_to": "YYYY-MM",
  "location": "<place name>"
}

Rules:
- location MUST be a human-readable place name (e.g. "Cambridge, UK"). NEVER return coordinates.
- Default location to "Cambridge, UK" when none is specified.
- Default category to "all-crime" when intent is unclear.
- Resolve all relative date expressions to explicit YYYY-MM values:
    "last month"      → date_from and date_to both = ${lastMonthStr}
    "last 3 months"   → date_from = 3 months before ${lastMonthStr}, date_to = ${lastMonthStr}
    "last year"       → date_from = 12 months before ${lastMonthStr}, date_to = ${lastMonthStr}
    "January 2024"    → date_from: "2024-01", date_to: "2024-01"
    no date mentioned → date_from and date_to both = ${lastMonthStr}
- Do NOT include viz_hint in your output.

Valid category slugs:
  all-crime, anti-social-behaviour, bicycle-theft, burglary,
  criminal-damage-arson, drugs, other-theft, possession-of-weapons,
  public-order, robbery, shoplifting, theft-from-the-person,
  vehicle-crime, violent-crime, other-crime`;
}

export function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export function deriveVizHint(plan: QueryPlan, rawText: string, intent = "crime"): VizHint {
  if (intent === "weather") return "dashboard";
  const lower = rawText.toLowerCase();
  if (
    lower.includes("list") ||
    lower.includes("show me") ||
    lower.includes("what are") ||
    lower.includes("details") ||
    lower.includes("table")
  ) {
    return "table";
  }
  if (plan.date_from !== plan.date_to) {
    return "bar";
  }
  return "map";
}

export function expandDateRange(dateFrom: string, dateTo: string): string[] {
  const [fromYear, fromMonth] = dateFrom.split("-").map(Number);
  const [toYear, toMonth] = dateTo.split("-").map(Number);

  const fromTotal = fromYear * 12 + fromMonth;
  const toTotal = toYear * 12 + toMonth;

  if (toTotal < fromTotal) {
    throw new Error(
      `date_to (${dateTo}) must not be earlier than date_from (${dateFrom})`,
    );
  }

  const months: string[] = [];
  for (let t = fromTotal; t <= toTotal; t++) {
    const year = Math.floor((t - 1) / 12);
    const month = ((t - 1) % 12) + 1;
    months.push(`${year}-${String(month).padStart(2, "0")}`);
  }
  return months;
}

export async function parseIntent(rawText: string): Promise<QueryPlan> {
  if (!rawText || rawText.trim() === "") {
    throw new Error("Query text must not be empty");
  }

  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    max_tokens: 256,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: rawText },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";
  const cleaned = stripFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${cleaned}`);
  }

  const result = QueryPlanSchema.safeParse(parsed);

  if (result.success) {
    return result.data;
  }

  // Build structured IntentError with understood/missing fields
  const obj =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  const requiredFields = ["category", "date_from", "date_to", "location"];

  const understood: Partial<QueryPlan> = {};
  const missing: string[] = [];

  for (const field of requiredFields) {
    if (obj[field] !== undefined && obj[field] !== null && obj[field] !== "") {
      (understood as Record<string, unknown>)[field] = obj[field];
    } else {
      missing.push(field);
    }
  }

  throw {
    error: "incomplete_intent",
    understood,
    missing,
    message: `Could not determine: ${missing.join(", ")}. Please rephrase your query.`,
  };
}
