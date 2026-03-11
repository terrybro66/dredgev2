import OpenAI from "openai";
import { QueryPlanSchema, QueryPlan, VizHint } from "@dredge/schemas";

// TODO: configure DeepSeek client
// const client = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com" });

// TODO: implement buildSystemPrompt(): string
// Rules to enforce in the prompt:
// - return JSON only, no prose, no markdown fences
// - location must be a place name, never coordinates
// - default location to "Cambridge, UK" when none specified
// - default category to "all-crime" when intent is unclear
// - resolve date_from and date_to as explicit YYYY-MM values:
//     "last month"   → previous full calendar month for both
//     "last 3 months"→ date_from = 3 months ago, date_to = last full month
//     "last year"    → date_from = 12 months ago, date_to = last full month
//     "January 2024" → date_from: "2024-01", date_to: "2024-01"
//     no date        → default to last full month for both
// - do NOT include viz_hint in output — derived after parsing
// - list all valid category slugs with descriptions

// TODO: implement stripFences(text: string): string
// - remove ```json ... ``` wrappers from LLM output

export function stripFences(_text: string): string {
  throw new Error("TODO: implement stripFences");
}

// TODO: implement deriveVizHint(plan: QueryPlan, rawText: string): VizHint
// - if date_from !== date_to → return "bar"
// - if category === "all-crime" and range > 1 month → return "bar"
// - if rawText contains "list", "show me", "what are", "details", "table" → return "table"
// - default → return "map"

export function deriveVizHint(_plan: QueryPlan, _rawText: string): VizHint {
  throw new Error("TODO: implement deriveVizHint");
}

// TODO: implement expandDateRange(date_from: string, date_to: string): string[]
// - return ordered array of all YYYY-MM months between and including from/to
// - throw if date_to is earlier than date_from

export function expandDateRange(_dateFrom: string, _dateTo: string): string[] {
  throw new Error("TODO: implement expandDateRange");
}

// TODO: implement parseIntent(rawText: string): Promise<QueryPlan>
// - throw "Query text must not be empty" on blank input
// - call DeepSeek with system prompt + user message, max_tokens: 256
// - strip fences, parse JSON
// - validate with QueryPlanSchema.safeParse()
// - on failure: throw structured IntentError with understood/missing fields populated
// - on success: return validated plan

export async function parseIntent(_rawText: string): Promise<QueryPlan> {
  throw new Error("TODO: implement parseIntent");
}
