/**
 * pattern-store.ts — Phase E.2
 *
 * Records successful query → domain resolutions back into domain_embeddings
 * so the pgvector classifier improves with real traffic.
 *
 * A "successful" pattern is one where:
 *   - the /execute handler returned results (rows > 0)
 *   - the resolved domain is known and registered
 *
 * We only store a pattern if an identical exampleQuery doesn't already exist
 * for that domain — avoids churning duplicate embeddings.
 *
 * Fire-and-forget — never throws, never blocks a response.
 */

import { generateEmbedding } from "./embedding";

export async function recordSuccessfulPattern(
  query: string,
  domain: string,
  prisma: any,
): Promise<void> {
  if (!query || !domain) return;

  try {
    // Skip if this exact example already exists
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM domain_embeddings
      WHERE domain = ${domain}
        AND "exampleQuery" = ${query}
      LIMIT 1
    `;
    if (existing.length > 0) return;

    const embedding = await generateEmbedding(query);
    const vector = `[${embedding.join(",")}]`;
    const id = `learned:${domain}:${query.slice(0, 80)}`;

    await prisma.$executeRawUnsafe(
      `DELETE FROM domain_embeddings WHERE id = $1`,
      id,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO domain_embeddings (id, domain, "exampleQuery", embedding, "createdAt")
       VALUES ($1, $2, $3, $4::vector, NOW())`,
      id,
      domain,
      query,
      vector,
    );

    console.log(JSON.stringify({ event: "pattern_learned", domain, query }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      JSON.stringify({
        event: "pattern_store_failed",
        domain,
        query,
        error: message,
      }),
    );
  }
}
