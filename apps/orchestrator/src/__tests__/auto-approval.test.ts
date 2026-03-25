/**
 * Block 3.10 — Auto-approval threshold
 *
 * Branch: feat/auto-approval
 *
 * Tests cover the auto-approval logic that bypasses human review for
 * low-risk discovered sources:
 *
 *   Auto-approve criteria (ALL must be true):
 *     - confidence > 0.9
 *     - providerType is "rest" (not scrape)
 *     - URL domain is in the known-safe government domain list
 *
 *   Manual review for everything else:
 *     - confidence <= 0.9
 *     - scraping sources (any confidence)
 *     - novel/unknown source types
 *     - non-government domains
 *
 *   Auditability: auto-approved records are still written to DomainDiscovery
 *   with status: "registered" and approved: true — not silently skipped.
 *
 * Run:
 *   pnpm vitest run src/__tests__/auto-approval.test.ts --reporter=verbose
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoist mock factories ──────────────────────────────────────────────────────

const { mockDiscoveryCreate } = vi.hoisted(() => ({
  mockDiscoveryCreate: vi.fn(),
}));
const { mockDiscoveryUpdate } = vi.hoisted(() => ({
  mockDiscoveryUpdate: vi.fn(),
}));
const { mockRegisterDiscoveredDomain } = vi.hoisted(() => ({
  mockRegisterDiscoveredDomain: vi.fn(),
}));
const { mockDiscoverSources } = vi.hoisted(() => ({
  mockDiscoverSources: vi.fn(),
}));
const { mockSampleSource } = vi.hoisted(() => ({
  mockSampleSource: vi.fn(),
}));
const { mockProposeDomainConfig } = vi.hoisted(() => ({
  mockProposeDomainConfig: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    domainDiscovery: {
      create: mockDiscoveryCreate,
      update: mockDiscoveryUpdate,
    },
  },
}));

vi.mock("../agent/registration", () => ({
  registerDiscoveredDomain: mockRegisterDiscoveredDomain,
}));

vi.mock("../agent/workflows/domain-discovery-workflow", () => ({
  discoverSources: mockDiscoverSources,
  sampleSource: mockSampleSource,
  proposeDomainConfig: mockProposeDomainConfig,
}));

// ── Shared fixtures ───────────────────────────────────────────────────────────

const highConfidenceGovSource = {
  url: "https://environment.data.gov.uk/flood-monitoring/api/floodAreas",
  format: "rest" as const,
  description: "Environment Agency flood monitoring API",
  confidence: 0.95,
};

const highConfidenceGovConfig = {
  name: "flood-risk-gb",
  intent: "flood risk",
  country_code: "GB",
  apiUrl: "https://environment.data.gov.uk/flood-monitoring/api/floodAreas",
  providerType: "rest" as const,
  fieldMap: { description: "description" },
  storeResults: true,
  refreshPolicy: "daily" as const,
  ephemeralRationale: "",
  confidence: 0.95,
  sampleRows: [{ description: "Flood alert" }],
};

const lowConfidenceConfig = {
  ...highConfidenceGovConfig,
  confidence: 0.7,
};

const scrapeConfig = {
  ...highConfidenceGovConfig,
  providerType: "scrape" as const,
  confidence: 0.95,
};

const nonGovConfig = {
  ...highConfidenceGovConfig,
  apiUrl: "https://some-random-website.com/api/data",
  confidence: 0.95,
};

const mockPrisma = {
  domainDiscovery: {
    create: mockDiscoveryCreate,
    update: mockDiscoveryUpdate,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockDiscoveryCreate.mockResolvedValue({ id: "disc-1" });
  mockDiscoveryUpdate.mockResolvedValue({});
  mockRegisterDiscoveredDomain.mockResolvedValue({
    path: "persistent",
    domainName: "flood-risk-gb",
  });
  mockDiscoverSources.mockResolvedValue([highConfidenceGovSource]);
  mockSampleSource.mockResolvedValue({
    rows: [{ description: "Flood alert" }],
    format: "rest",
  });
  mockProposeDomainConfig.mockResolvedValue(highConfidenceGovConfig);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DOMAIN_DISCOVERY_ENABLED;
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — shouldAutoApprove utility
// ─────────────────────────────────────────────────────────────────────────────

describe("shouldAutoApprove — criteria evaluation", () => {
  it("returns true for a high-confidence REST API from a government domain", async () => {
    const { shouldAutoApprove } = await import("../agent/auto-approval");

    const result = shouldAutoApprove({
      confidence: 0.95,
      providerType: "rest",
      apiUrl: "https://environment.data.gov.uk/flood-monitoring/api",
    });

    expect(result).toBe(true);
  });

  it("returns true for data.gov.uk domain", async () => {
    const { shouldAutoApprove } = await import("../agent/auto-approval");

    expect(
      shouldAutoApprove({
        confidence: 0.92,
        providerType: "rest",
        apiUrl: "https://data.gov.uk/api/datasets",
      }),
    ).toBe(true);
  });

  it("returns true for api.ons.gov.uk domain", async () => {
    const { shouldAutoApprove } = await import("../agent/auto-approval");

    expect(
      shouldAutoApprove({
        confidence: 0.91,
        providerType: "rest",
        apiUrl: "https://api.ons.gov.uk/v1/datasets",
      }),
    ).toBe(true);
  });

  it("returns false when confidence is exactly 0.9 (threshold is strictly greater than)", async () => {
    const { shouldAutoApprove } = await import("../agent/auto-approval");

    const result = shouldAutoApprove({
      confidence: 0.9,
      providerType: "rest",
      apiUrl: "https://environment.data.gov.uk/api",
    });

    expect(result).toBe(false);
  });

  it("returns false when confidence is below 0.9", async () => {
    const { shouldAutoApprove } = await import("../agent/auto-approval");

    const result = shouldAutoApprove({
      confidence: 0.7,
      providerType: "rest",
      apiUrl: "https://environment.data.gov.uk/api",
    });

    expect(result).toBe(false);
  });

  it("returns false for a scrape source even with high confidence and gov domain", async () => {
    const { shouldAutoApprove } = await import("../agent/auto-approval");

    const result = shouldAutoApprove({
      confidence: 0.95,
      providerType: "scrape",
      apiUrl: "https://environment.data.gov.uk/flood-monitoring",
    });

    expect(result).toBe(false);
  });

  it("returns false for a non-government domain even with high confidence", async () => {
    const { shouldAutoApprove } = await import("../agent/auto-approval");

    const result = shouldAutoApprove({
      confidence: 0.95,
      providerType: "rest",
      apiUrl: "https://some-random-website.com/api/data",
    });

    expect(result).toBe(false);
  });

  it("returns false for a csv source from a gov domain", async () => {
    const { shouldAutoApprove } = await import("../agent/auto-approval");

    const result = shouldAutoApprove({
      confidence: 0.95,
      providerType: "csv",
      apiUrl: "https://data.gov.uk/dataset/file.csv",
    });

    expect(result).toBe(false);
  });

  it("is auditable — returns a reason string alongside the boolean", async () => {
    const { shouldAutoApprove, autoApprovalReason } =
      await import("../agent/auto-approval");

    const approved = shouldAutoApprove({
      confidence: 0.95,
      providerType: "rest",
      apiUrl: "https://environment.data.gov.uk/api",
    });

    const reason = autoApprovalReason({
      confidence: 0.95,
      providerType: "rest",
      apiUrl: "https://environment.data.gov.uk/api",
    });

    expect(approved).toBe(true);
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
  });

  it("returns a rejection reason when criteria are not met", async () => {
    const { autoApprovalReason } = await import("../agent/auto-approval");

    const reason = autoApprovalReason({
      confidence: 0.7,
      providerType: "rest",
      apiUrl: "https://environment.data.gov.uk/api",
    });

    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — domain-discovery.ts auto-approval integration
// ─────────────────────────────────────────────────────────────────────────────

describe("domainDiscovery.run — auto-approval path", () => {
  it("calls registerDiscoveredDomain immediately when auto-approval criteria are met", async () => {
    mockProposeDomainConfig.mockResolvedValue(highConfidenceGovConfig);

    const { domainDiscovery } = await import("../agent/domain-discovery");
    process.env.DOMAIN_DISCOVERY_ENABLED = "true";
    await domainDiscovery.run(
      { intent: "flood risk", country_code: "GB" },
      mockPrisma,
    );

    expect(mockRegisterDiscoveredDomain).toHaveBeenCalledOnce();
  });

  it("does NOT call registerDiscoveredDomain when confidence is too low", async () => {
    mockProposeDomainConfig.mockResolvedValue(lowConfidenceConfig);

    const { domainDiscovery } = await import("../agent/domain-discovery");
    process.env.DOMAIN_DISCOVERY_ENABLED = "true";
    await domainDiscovery.run(
      { intent: "flood risk", country_code: "GB" },
      mockPrisma,
    );

    expect(mockRegisterDiscoveredDomain).not.toHaveBeenCalled();
  });

  it("does NOT auto-approve scrape sources", async () => {
    mockProposeDomainConfig.mockResolvedValue(scrapeConfig);
    mockDiscoverSources.mockResolvedValue([
      {
        ...highConfidenceGovSource,
        format: "scrape",
      },
    ]);

    const { domainDiscovery } = await import("../agent/domain-discovery");
    process.env.DOMAIN_DISCOVERY_ENABLED = "true";
    await domainDiscovery.run(
      { intent: "cinema listings", country_code: "GB" },
      mockPrisma,
    );

    expect(mockRegisterDiscoveredDomain).not.toHaveBeenCalled();
  });

  it("does NOT auto-approve non-government domains", async () => {
    mockProposeDomainConfig.mockResolvedValue(nonGovConfig);
    mockDiscoverSources.mockResolvedValue([
      {
        url: "https://some-random-website.com/api/data",
        format: "rest",
        description: "Random website",
        confidence: 0.95,
      },
    ]);

    const { domainDiscovery } = await import("../agent/domain-discovery");
    process.env.DOMAIN_DISCOVERY_ENABLED = "true";
    await domainDiscovery.run(
      { intent: "some data", country_code: "GB" },
      mockPrisma,
    );

    expect(mockRegisterDiscoveredDomain).not.toHaveBeenCalled();
  });

  it("writes DomainDiscovery record with status registered on auto-approval", async () => {
    mockProposeDomainConfig.mockResolvedValue(highConfidenceGovConfig);

    const { domainDiscovery } = await import("../agent/domain-discovery");
    process.env.DOMAIN_DISCOVERY_ENABLED = "true";
    await domainDiscovery.run(
      { intent: "flood risk", country_code: "GB" },
      mockPrisma,
    );

    expect(mockDiscoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "registered",
          approved: true,
        }),
      }),
    );
  });

  it("still writes requires_review when auto-approval criteria are not met", async () => {
    mockProposeDomainConfig.mockResolvedValue(lowConfidenceConfig);

    const { domainDiscovery } = await import("../agent/domain-discovery");
    process.env.DOMAIN_DISCOVERY_ENABLED = "true";
    await domainDiscovery.run(
      { intent: "flood risk", country_code: "GB" },
      mockPrisma,
    );

    expect(mockDiscoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "requires_review",
        }),
      }),
    );
  });

  it("auto-approval failure falls back to requires_review — never loses the record", async () => {
    mockProposeDomainConfig.mockResolvedValue(highConfidenceGovConfig);
    mockRegisterDiscoveredDomain.mockRejectedValue(
      new Error("Registration failed"),
    );

    const { domainDiscovery } = await import("../agent/domain-discovery");
    process.env.DOMAIN_DISCOVERY_ENABLED = "true";
    // Should not throw — falls back gracefully
    await expect(
      domainDiscovery.run(
        { intent: "flood risk", country_code: "GB" },
        mockPrisma,
      ),
    ).resolves.not.toThrow();

    // Record should be marked requires_review after auto-approval failure
    const updateCalls = mockDiscoveryUpdate.mock.calls;
    const finalUpdate = updateCalls[updateCalls.length - 1]?.[0];
    expect(finalUpdate?.data?.status).toBe("requires_review");
  });
});
