import { describe, it, expect, beforeEach, vi } from "vitest";

describe("db singleton", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("prisma instance is defined", async () => {
    // TODO: import ../db and assert prisma is defined
  });

  it("returns the same instance on multiple imports", async () => {
    // TODO: import ../db twice and assert instanceA === instanceB
  });
});
