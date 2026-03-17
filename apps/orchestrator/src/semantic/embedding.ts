export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://dredge.local",
      "X-OpenRouter-Title": "DREDGE",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
      encoding_format: "float",
    }),
  });

  const data = (await response.json()) as any;
  if (!response.ok) {
    throw new Error(
      `Embeddings API error: ${response.status} ${JSON.stringify(data)}`,
    );
  }
  return data.data[0].embedding;
}
