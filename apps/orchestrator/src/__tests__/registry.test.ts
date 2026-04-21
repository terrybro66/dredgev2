import { describe, it, expect, beforeEach } from "vitest";
import {
  registerDomain,
  getDomainForQuery,
  getDomainByName,
  clearRegistry,
} from "../domains/registry";
import type { DomainAdapter } from "../domains/registry";
import { makeConfig } from "@mocks/mockConfig";

beforeEach(() => {
  clearRegistry();
});

function makeAdapter(
  name: string,
  countries: string[],
  intents: string[],
): DomainAdapter {
  return {
    config: makeConfig({ name, countries, intents }),
    fetchData: async (_plan: any, _poly: string) => [],
    flattenRow: (row: unknown) => row as Record<string, unknown>,
    storeResults: async (
      _queryId: string,
      _rows: unknown[],
      _prisma: any,
    ) => {},
  };
}

describe("getDomainForQuery", () => {
  it("returns crime-uk adapter for GB + crime", () => {
    registerDomain(makeAdapter("crime-uk", ["GB"], ["crime"]));
    expect(getDomainForQuery("GB", "crime")?.config.identity.name).toBe("crime-uk");
  });

  it("returns undefined for US + crime when no US adapter registered", () => {
    registerDomain(makeAdapter("crime-uk", ["GB"], ["crime"]));
    expect(getDomainForQuery("US", "crime")).toBeUndefined();
  });

  it("returns undefined for GB + weather when no weather adapter registered", () => {
    registerDomain(makeAdapter("crime-uk", ["GB"], ["crime"]));
    expect(getDomainForQuery("GB", "weather")).toBeUndefined();
  });

  it("matches any country when countries is empty", () => {
    registerDomain(makeAdapter("weather", [], ["weather"]));
    expect(getDomainForQuery("GB", "weather")?.config.identity.name).toBe("weather");
    expect(getDomainForQuery("US", "weather")?.config.identity.name).toBe("weather");
    expect(getDomainForQuery("DE", "weather")?.config.identity.name).toBe("weather");
  });

  it("does not match on intent alone when countries restricts", () => {
    registerDomain(makeAdapter("crime-uk", ["GB"], ["crime"]));
    expect(getDomainForQuery("US", "crime")).toBeUndefined();
  });

  it("does not match on country alone when intent does not match", () => {
    registerDomain(makeAdapter("crime-uk", ["GB"], ["crime"]));
    expect(getDomainForQuery("GB", "weather")).toBeUndefined();
  });
});

describe("getDomainByName", () => {
  it("returns correct adapter by name", () => {
    registerDomain(makeAdapter("crime-uk", ["GB"], ["crime"]));
    expect(getDomainByName("crime-uk")?.config.identity.name).toBe("crime-uk");
  });

  it("returns undefined for unknown name", () => {
    expect(getDomainByName("unknown-domain")).toBeUndefined();
  });
});

describe("registerDomain", () => {
  it("registering same domain name twice overwrites the first", () => {
    registerDomain(makeAdapter("crime-uk", ["GB"], ["crime"]));
    registerDomain(makeAdapter("crime-uk", ["GB", "IE"], ["crime"]));
    expect(getDomainByName("crime-uk")?.config.identity.countries).toContain("IE");
  });
});
