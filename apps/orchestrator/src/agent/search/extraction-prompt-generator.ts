const FALLBACK_PROMPT =
  "Extract all data items from this page. " +
  "Return each item as an object with relevant fields (title, name, time, date, description, etc.). " +
  "Return ALL items as an array under the key 'items'.";

const SYSTEM_PROMPT =
  "You are a web scraping assistant. Given a user's data intent, write a concise Stagehand extraction prompt. " +
  "The prompt must instruct the LLM to return results as an array of objects under the key 'items'. " +
  "Each object should have named fields appropriate for the intent. " +
  "Be specific about field names. Keep the prompt under 100 words. Return only the prompt text, no explanation.";

export async function generateExtractionPrompt(
  intent: string,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return FALLBACK_PROMPT;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://dredge.local",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Intent: ${intent}` },
        ],
        max_tokens: 150,
      }),
    });

    if (!res.ok) return FALLBACK_PROMPT;

    const data = (await res.json()) as any;
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    return text.length > 0 ? text : FALLBACK_PROMPT;
  } catch {
    return FALLBACK_PROMPT;
  }
}
