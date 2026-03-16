import { generateEmbedding } from "./embedding";

export interface ClassifyResult {
  domain: string | null;
  confidence: number;
  intent: string;
}

const CONFIDENCE_THRESHOLD = 0.5;

export async function classifyIntent(
  text: string,
  prisma: any,
): Promise<ClassifyResult> {
  const embedding = await generateEmbedding(text);
  const vector = `[${embedding.join(",")}]`;

  const results: { domain: string; intent: string; similarity: number }[] =
    await prisma.$queryRaw`
      SELECT domain, "exampleQuery" as intent,
      1 - (embedding <=> ${vector}::vector) as similarity
      FROM domain_embeddings
      ORDER BY embedding <=> ${vector}::vector
      LIMIT 1
    `;

  if (!results || results.length === 0) {
    return { domain: null, confidence: 0, intent: "unknown" };
  }

  const top = results[0];
  if (top.similarity < CONFIDENCE_THRESHOLD) {
    return { domain: null, confidence: top.similarity, intent: "unknown" };
  }

  return {
    domain: top.domain,
    confidence: top.similarity,
    intent: top.intent,
  };
}
export async function registerDomainEmbeddings(
  domain: string,
  exampleQueries: string[],
  prisma: any,
): Promise<void> {
  for (const exampleQuery of exampleQueries) {
    const embedding = await generateEmbedding(exampleQuery);
    const vector = `[${embedding.join(",")}]`;

    await prisma.domainEmbedding.upsert({
      where: { id: `${domain}:${exampleQuery}` },
      update: { embedding: vector },
      create: {
        id: `${domain}:${exampleQuery}`,
        domain,
        exampleQuery,
        embedding: vector,
      },
    });
  }
}
