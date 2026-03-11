import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  function MockOpenAI() {
    return { chat: { completions: { create: mockCreate } } };
  }
  return { default: MockOpenAI };
});

describe("parseIntent", () => {
  it("returns a valid QueryPlan with category, date_from, date_to, location", async () => { /* TODO */ });
  it("viz_hint is NOT present on the returned plan", async () => { /* TODO */ });
  it("poly is NOT present on the returned plan", async () => { /* TODO */ });
  it("location is a place name, never a coordinate string", async () => { /* TODO */ });
  it("defaults category to all-crime when not mentioned", async () => { /* TODO */ });
  it(resolves
