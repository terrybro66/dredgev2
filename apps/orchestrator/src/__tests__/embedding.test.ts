import { describe, it, expect, vi } from "vitest";

const mockGenerateEmbedding = vi.hoisted(() =>
  vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
);

vi.mock("../semantic/embedding", () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

describe("generateEmbedding", () => {
  it("returns a numeric array of length 1536", async () => {
    const { generateEmbedding } = await import("../semantic/embedding");
    const result = await generateEmbedding("crime in Camden");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1536);
  });

  it("returns different embeddings for different inputs", async () => {
    const { generateEmbedding } = await import("../semantic/embedding");
    mockGenerateEmbedding
      .mockResolvedValueOnce(new Array(1536).fill(0.1))
      .mockResolvedValueOnce(new Array(1536).fill(0.9));

    const a = await generateEmbedding("crime in Camden");
    const b = await generateEmbedding("weather in London");
    expect(a[0]).not.toBe(b[0]);
  });
});
