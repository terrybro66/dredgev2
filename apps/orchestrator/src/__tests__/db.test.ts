import { describe, it, expect, beforeEach, vi } from "vitest";

const { PrismaClient } = vi.hoisted(() => {
  function PrismaClient(this: any) {
    this.$connect = () => {};
    this.$disconnect = () => {};
  }
  return { PrismaClient };
});

vi.mock("@dredge/database", () => ({ PrismaClient }));

describe("db singleton", () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as any).prisma = undefined;
  });

  it("prisma instance is defined", async () => {
    const { prisma } = await import("../db");
    expect(prisma).toBeDefined();
  });

  it("returns the same instance on multiple imports", async () => {
    const modA = await import("../db");
    const modB = await import("../db");
    expect(modA.prisma).toBe(modB.prisma);
  });
});
