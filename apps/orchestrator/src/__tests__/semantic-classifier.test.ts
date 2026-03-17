import { describe, it, expect, vi } from "vitest";

const mockGenerateEmbedding = vi.hoisted(() =>
  vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
);

vi.mock("../semantic/embedding", () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

describe("classifyIntent", () => {
  it("returns the closest domain match above confidence threshold", async () => {
    const { classifyIntent } = await import("../semantic/classifier");
    const mockPrisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([
          { domain: "crime-uk", intent: "crime", similarity: 0.92 },
        ]),
    };
    const result = await classifyIntent(
      "show me burglaries in Bristol",
      mockPrisma as any,
    );
    expect(result.domain).toBe("crime-uk");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("returns low confidence when no domain matches well", async () => {
    const { classifyIntent } = await import("../semantic/classifier");
    const mockPrisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([
          { domain: "crime-uk", intent: "crime", similarity: 0.2 },
        ]),
    };
    const result = await classifyIntent(
      "what is the meaning of life",
      mockPrisma as any,
    );
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.domain).toBeNull();
  });

  it("returns weather domain for weather queries", async () => {
    const { classifyIntent } = await import("../semantic/classifier");
    const mockPrisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([
          { domain: "weather", intent: "weather", similarity: 0.95 },
        ]),
    };
    const result = await classifyIntent(
      "what is the weather like in Manchester",
      mockPrisma as any,
    );
    expect(result.domain).toBe("weather");
  });

  it("returns null domain when no embeddings exist", async () => {
    const { classifyIntent } = await import("../semantic/classifier");
    const mockPrisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const result = await classifyIntent("anything", mockPrisma as any);
    expect(result.domain).toBeNull();
    expect(result.confidence).toBe(0);
  });
});

describe("registerDomainEmbeddings", () => {
  it("stores example query embeddings for a domain", async () => {
    const { registerDomainEmbeddings } = await import("../semantic/classifier");

    const mockPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    };

    await registerDomainEmbeddings(
      "crime-uk",
      ["show me crime in Camden", "burglaries in Bristol"],
      mockPrisma as any,
    );

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalled();
  });
});
