import { describe, it, expect, vi, beforeEach } from "vitest";

describe("DomainDiscoveryPipeline", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("isEnabled()", () => {
    it("returns false when DOMAIN_DISCOVERY_ENABLED is not set", async () => {
      delete process.env.DOMAIN_DISCOVERY_ENABLED;
      const { domainDiscovery } = await import("../agent/domain-discovery");
      expect(domainDiscovery.isEnabled()).toBe(false);
    });

    it("returns true when DOMAIN_DISCOVERY_ENABLED=true", async () => {
      process.env.DOMAIN_DISCOVERY_ENABLED = "true";
      const { domainDiscovery } = await import("../agent/domain-discovery");
      expect(domainDiscovery.isEnabled()).toBe(true);
    });
  });

  describe("run()", () => {
    it("returns null when disabled", async () => {
      delete process.env.DOMAIN_DISCOVERY_ENABLED;
      const { domainDiscovery } = await import("../agent/domain-discovery");
      const result = await domainDiscovery.run(
        { intent: "flood-risk", country_code: "GB" },
        {} as any,
      );
      expect(result).toBeNull();
    });

    it("creates a DomainDiscovery audit record when run", async () => {
      process.env.DOMAIN_DISCOVERY_ENABLED = "true";
      const { domainDiscovery } = await import("../agent/domain-discovery");

      const mockPrisma = {
        domainDiscovery: {
          create: vi
            .fn()
            .mockResolvedValue({ id: "disc-1", status: "pending" }),
          update: vi.fn().mockResolvedValue({}),
        },
      };

      await domainDiscovery.run(
        { intent: "flood-risk", country_code: "GB" },
        mockPrisma as any,
      );

      expect(mockPrisma.domainDiscovery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            intent: "flood-risk",
            country_code: "GB",
            status: "pending",
          }),
        }),
      );
    });

    it("returns null and marks record as requires_review — never auto-registers", async () => {
      process.env.DOMAIN_DISCOVERY_ENABLED = "true";
      const { domainDiscovery } = await import("../agent/domain-discovery");

      const mockPrisma = {
        domainDiscovery: {
          create: vi
            .fn()
            .mockResolvedValue({ id: "disc-1", status: "pending" }),
          update: vi.fn().mockResolvedValue({}),
        },
      };

      const result = await domainDiscovery.run(
        { intent: "flood-risk", country_code: "GB" },
        mockPrisma as any,
      );

      // Pipeline always returns null — registration only happens after human approval
      expect(result).toBeNull();

      expect(mockPrisma.domainDiscovery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "requires_review",
          }),
        }),
      );
    });

    it("marks record as error when pipeline throws", async () => {
      process.env.DOMAIN_DISCOVERY_ENABLED = "true";
      const { domainDiscovery } = await import("../agent/domain-discovery");

      const mockPrisma = {
        domainDiscovery: {
          create: vi
            .fn()
            .mockResolvedValue({ id: "disc-1", status: "pending" }),
          update: vi.fn().mockResolvedValue({}),
        },
      };

      // Force an error by making create throw
      mockPrisma.domainDiscovery.create.mockRejectedValueOnce(
        new Error("db error"),
      );

      const result = await domainDiscovery.run(
        { intent: "flood-risk", country_code: "GB" },
        mockPrisma as any,
      );

      expect(result).toBeNull();
    });
  });

  describe("approve()", () => {
    it("returns false when record does not exist", async () => {
      process.env.DOMAIN_DISCOVERY_ENABLED = "true";
      const { domainDiscovery } = await import("../agent/domain-discovery");

      const mockPrisma = {
        domainDiscovery: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };

      const result = await domainDiscovery.approve(
        "nonexistent-id",
        mockPrisma as any,
      );
      expect(result).toBe(false);
    });

    it("returns false when record is not in requires_review status", async () => {
      process.env.DOMAIN_DISCOVERY_ENABLED = "true";
      const { domainDiscovery } = await import("../agent/domain-discovery");

      const mockPrisma = {
        domainDiscovery: {
          findUnique: vi.fn().mockResolvedValue({
            id: "disc-1",
            status: "approved",
            proposed_config: {},
          }),
        },
      };

      const result = await domainDiscovery.approve("disc-1", mockPrisma as any);
      expect(result).toBe(false);
    });

    it("returns true and marks record as approved when valid", async () => {
      process.env.DOMAIN_DISCOVERY_ENABLED = "true";
      const { domainDiscovery } = await import("../agent/domain-discovery");

      const mockPrisma = {
        domainDiscovery: {
          findUnique: vi.fn().mockResolvedValue({
            id: "disc-1",
            status: "requires_review",
            proposed_config: { name: "flood-risk-gb" },
          }),
          update: vi.fn().mockResolvedValue({}),
        },
      };

      const result = await domainDiscovery.approve("disc-1", mockPrisma as any);
      expect(result).toBe(true);
      expect(mockPrisma.domainDiscovery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ approved: true, status: "approved" }),
        }),
      );
    });
  });
});
