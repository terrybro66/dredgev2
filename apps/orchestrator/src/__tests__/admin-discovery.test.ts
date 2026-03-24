/**
 * Block C — Admin approval endpoint
 *
 * Branch: feat/admin-approval-endpoint
 *
 * Tests are grouped into four suites:
 *
 *   1. DomainDiscovery schema columns (integration, real DB)
 *      Confirms store_results, refresh_policy, ephemeral_rationale exist as
 *      top-level columns — domain-discovery.ts already writes to them but the
 *      schema was missing them. Migration must be applied before these pass.
 *
 *   2. GET /admin/discovery (unit, mocked DB)
 *      Lists requires_review records. Returns 401 without auth.
 *
 *   3. POST /admin/discovery/:id/approve (unit, mocked DB)
 *      Applies overrides, triggers registration, returns path taken.
 *
 *   4. POST /admin/discovery/:id/reject (unit, mocked DB)
 *      Marks record rejected with reason, removes from review queue.
 *
 * Run:
 *   pnpm vitest run src/__tests__/admin-discovery.test.ts --reporter=verbose
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  beforeEach,
} from "vitest";
import { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import type { Router } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — DomainDiscovery schema columns (integration, real DB)
// ─────────────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();
const createdDiscoveryIds: string[] = [];

beforeAll(async () => {
  await prisma.domainDiscovery.deleteMany({
    where: { intent: { startsWith: "__test__" } },
  });
});

afterAll(async () => {
  if (createdDiscoveryIds.length > 0) {
    await prisma.domainDiscovery.deleteMany({
      where: { id: { in: [...createdDiscoveryIds] } },
    });
  }
  await prisma.$disconnect();
});

function minimalDiscovery(overrides: Record<string, unknown> = {}) {
  return {
    intent: "__test__cinema-listings",
    country_code: "GB",
    status: "requires_review",
    ...overrides,
  };
}

describe("DomainDiscovery model — top-level ephemeral columns", () => {
  it("store_results column exists and defaults to null", async () => {
    const record = await (prisma as any).domainDiscovery.create({
      data: minimalDiscovery(),
    });
    createdDiscoveryIds.push(record.id);

    expect(record).toHaveProperty("store_results");
    expect(record.store_results).toBeNull();
  });

  it("store_results can be set to true", async () => {
    const record = await (prisma as any).domainDiscovery.create({
      data: minimalDiscovery({ store_results: true }),
    });
    createdDiscoveryIds.push(record.id);

    expect(record.store_results).toBe(true);
  });

  it("store_results can be set to false for ephemeral sources", async () => {
    const record = await (prisma as any).domainDiscovery.create({
      data: minimalDiscovery({ store_results: false }),
    });
    createdDiscoveryIds.push(record.id);

    expect(record.store_results).toBe(false);
  });

  it("refresh_policy column exists and defaults to null", async () => {
    const record = await (prisma as any).domainDiscovery.create({
      data: minimalDiscovery(),
    });
    createdDiscoveryIds.push(record.id);

    expect(record).toHaveProperty("refresh_policy");
    expect(record.refresh_policy).toBeNull();
  });

  it("refresh_policy can be set to any valid value", async () => {
    for (const policy of ["realtime", "daily", "weekly", "static"]) {
      const record = await (prisma as any).domainDiscovery.create({
        data: minimalDiscovery({
          intent: `__test__policy-${policy}`,
          refresh_policy: policy,
        }),
      });
      createdDiscoveryIds.push(record.id);
      expect(record.refresh_policy).toBe(policy);
    }
  });

  it("ephemeral_rationale column exists and defaults to null", async () => {
    const record = await (prisma as any).domainDiscovery.create({
      data: minimalDiscovery(),
    });
    createdDiscoveryIds.push(record.id);

    expect(record).toHaveProperty("ephemeral_rationale");
    expect(record.ephemeral_rationale).toBeNull();
  });

  it("ephemeral_rationale can be set to a string", async () => {
    const record = await (prisma as any).domainDiscovery.create({
      data: minimalDiscovery({
        ephemeral_rationale:
          "Cinema showtimes change daily and have no value being stored.",
      }),
    });
    createdDiscoveryIds.push(record.id);

    expect(record.ephemeral_rationale).toContain("Cinema showtimes");
  });

  it("all three columns round-trip together on a single record", async () => {
    const record = await (prisma as any).domainDiscovery.create({
      data: minimalDiscovery({
        store_results: false,
        refresh_policy: "realtime",
        ephemeral_rationale: "Live showtimes — discard after delivery.",
        proposed_config: {
          name: "cinema-listings-gb",
          storeResults: false,
          refreshPolicy: "realtime",
        },
        confidence: 0.85,
      }),
    });
    createdDiscoveryIds.push(record.id);

    expect(record.store_results).toBe(false);
    expect(record.refresh_policy).toBe("realtime");
    expect(record.ephemeral_rationale).toBe(
      "Live showtimes — discard after delivery.",
    );
    expect(record.confidence).toBe(0.85);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2–4 — Admin routes (unit, mocked DB + mocked registration)
// ─────────────────────────────────────────────────────────────────────────────

// Hoist all vi.fn() factories before vi.mock() calls.
const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }));
const { mockFindUnique } = vi.hoisted(() => ({ mockFindUnique: vi.fn() }));
const { mockUpdate } = vi.hoisted(() => ({ mockUpdate: vi.fn() }));
const { mockRegisterDomain: mockRegisterDomainFn } = vi.hoisted(() => ({
  mockRegisterDomain: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    domainDiscovery: {
      findMany: mockFindMany,
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

// Mock the registration step — it doesn't exist yet, this is the interface
// contract we're building toward.
vi.mock("../agent/registration", () => ({
  registerDiscoveredDomain: mockRegisterDomainFn,
}));

// A valid requires_review record fixture.
const reviewRecord = {
  id: "disc-1",
  intent: "cinema listings",
  country_code: "GB",
  status: "requires_review",
  confidence: 0.85,
  store_results: false,
  refresh_policy: "realtime",
  ephemeral_rationale: "Showtimes change constantly — discard after delivery.",
  proposed_config: {
    name: "cinema-listings-gb",
    fieldMap: { title: "description", showtime: "date" },
    storeResults: false,
    refreshPolicy: "realtime",
    ephemeralRationale: "Showtimes change constantly.",
  },
  sample_rows: [{ title: "Dune Part Two", showtime: "2025-06-01T19:30:00Z" }],
  createdAt: new Date("2025-06-01T10:00:00Z"),
  completedAt: new Date("2025-06-01T10:00:05Z"),
};

let adminRouter: Router;

beforeAll(async () => {
  ({ adminRouter } = await import("../admin/discovery"));
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/admin", adminRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
  mockFindUnique.mockResolvedValue(null);
  mockUpdate.mockResolvedValue({});
  mockRegisterDomainFn.mockResolvedValue({
    path: "ephemeral",
    domainName: "cinema-listings-gb",
  });
});

// ── GET /admin/discovery ──────────────────────────────────────────────────────

describe("GET /admin/discovery", () => {
  it("returns 401 without an auth token", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/discovery");
    expect(res.status).toBe(401);
  });

  it("returns 200 with a valid token", async () => {
    mockFindMany.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app)
      .get("/admin/discovery")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      );
    expect(res.status).toBe(200);
  });

  it("returns empty array when no requires_review records exist", async () => {
    mockFindMany.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app)
      .get("/admin/discovery")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      );
    expect(res.body).toEqual([]);
  });

  it("returns requires_review records with all review fields present", async () => {
    mockFindMany.mockResolvedValue([reviewRecord]);
    const app = buildApp();
    const res = await request(app)
      .get("/admin/discovery")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const record = res.body[0];
    expect(record).toMatchObject({
      id: "disc-1",
      intent: "cinema listings",
      confidence: 0.85,
      store_results: false,
      refresh_policy: "realtime",
      ephemeral_rationale: expect.any(String),
      proposed_config: expect.any(Object),
      sample_rows: expect.any(Array),
    });
  });

  it("queries the DB with status: requires_review filter", async () => {
    mockFindMany.mockResolvedValue([]);
    const app = buildApp();
    await request(app)
      .get("/admin/discovery")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      );

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "requires_review" }),
      }),
    );
  });

  it("does not return records with status registered", async () => {
    mockFindMany.mockResolvedValue([]); // filter is applied in query, not in code
    const app = buildApp();
    await request(app)
      .get("/admin/discovery")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      );

    // Assert the filter excludes non-review statuses
    const call = mockFindMany.mock.calls[0]?.[0];
    expect(call?.where?.status).toBe("requires_review");
  });
});

// ── POST /admin/discovery/:id/approve ─────────────────────────────────────────

describe("POST /admin/discovery/:id/approve", () => {
  it("returns 401 without an auth token", async () => {
    const app = buildApp();
    const res = await request(app).post("/admin/discovery/disc-1/approve");
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown id", async () => {
    mockFindUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post("/admin/discovery/nonexistent/approve")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      );
    expect(res.status).toBe(404);
  });

  it("returns 400 if the record is not in requires_review status", async () => {
    mockFindUnique.mockResolvedValue({ ...reviewRecord, status: "registered" });
    const app = buildApp();
    const res = await request(app)
      .post("/admin/discovery/disc-1/approve")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("not_reviewable");
  });

  it("returns 200 and triggers registration on a valid requires_review record", async () => {
    mockFindUnique.mockResolvedValue(reviewRecord);
    const app = buildApp();
    const res = await request(app)
      .post("/admin/discovery/disc-1/approve")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      );

    expect(res.status).toBe(200);
    expect(mockRegisterDomainFn).toHaveBeenCalledOnce();
  });

  it("response includes domainName and path from the registration step", async () => {
    mockFindUnique.mockResolvedValue(reviewRecord);
    mockRegisterDomainFn.mockResolvedValue({
      path: "ephemeral",
      domainName: "cinema-listings-gb",
    });
    const app = buildApp();
    const res = await request(app)
      .post("/admin/discovery/disc-1/approve")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      );

    expect(res.body).toMatchObject({
      domainName: "cinema-listings-gb",
      path: "ephemeral",
    });
  });

  it("applies storeResults override from request body before registration", async () => {
    mockFindUnique.mockResolvedValue(reviewRecord);
    const app = buildApp();
    await request(app)
      .post("/admin/discovery/disc-1/approve")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      )
      .send({ overrides: { storeResults: true } });

    // Registration must be called with the overridden config
    const call = mockRegisterDomainFn.mock.calls[0]?.[0];
    expect(call?.proposedConfig?.storeResults).toBe(true);
  });

  it("applies refreshPolicy override from request body before registration", async () => {
    mockFindUnique.mockResolvedValue(reviewRecord);
    const app = buildApp();
    await request(app)
      .post("/admin/discovery/disc-1/approve")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      )
      .send({ overrides: { refreshPolicy: "daily" } });

    const call = mockRegisterDomainFn.mock.calls[0]?.[0];
    expect(call?.proposedConfig?.refreshPolicy).toBe("daily");
  });

  it("marks the DomainDiscovery record as registered after successful registration", async () => {
    mockFindUnique.mockResolvedValue(reviewRecord);
    const app = buildApp();
    await request(app)
      .post("/admin/discovery/disc-1/approve")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      );

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "disc-1" },
        data: expect.objectContaining({ status: "registered" }),
      }),
    );
  });

  it("returns 500 and does not mark registered if registration throws", async () => {
    mockFindUnique.mockResolvedValue(reviewRecord);
    mockRegisterDomainFn.mockRejectedValue(new Error("Registration failed"));
    const app = buildApp();
    const res = await request(app)
      .post("/admin/discovery/disc-1/approve")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      );

    expect(res.status).toBe(500);
    // Must not have marked the record as registered
    const updateCalls = mockUpdate.mock.calls;
    const registeredCall = updateCalls.find(
      ([arg]) => arg?.data?.status === "registered",
    );
    expect(registeredCall).toBeUndefined();
  });
});

// ── POST /admin/discovery/:id/reject ──────────────────────────────────────────

describe("POST /admin/discovery/:id/reject", () => {
  it("returns 401 without an auth token", async () => {
    const app = buildApp();
    const res = await request(app).post("/admin/discovery/disc-1/reject");
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown id", async () => {
    mockFindUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post("/admin/discovery/nonexistent/reject")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      )
      .send({ reason: "Low confidence source" });
    expect(res.status).toBe(404);
  });

  it("returns 200 and marks the record as rejected with reason", async () => {
    mockFindUnique.mockResolvedValue(reviewRecord);
    const app = buildApp();
    const res = await request(app)
      .post("/admin/discovery/disc-1/reject")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      )
      .send({ reason: "Source is unreliable" });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "disc-1" },
        data: expect.objectContaining({
          status: "rejected",
          error_message: "Source is unreliable",
        }),
      }),
    );
  });

  it("rejected record does not appear in GET /admin/discovery response", async () => {
    // The findMany mock returns only requires_review records — rejected ones
    // are excluded by the DB query filter, not by application code.
    mockFindMany.mockResolvedValue([]); // rejected record not returned
    const app = buildApp();
    const res = await request(app)
      .get("/admin/discovery")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      );

    expect(res.body).toEqual([]);
    // The filter must be status: requires_review — not including rejected
    const call = mockFindMany.mock.calls[0]?.[0];
    expect(call?.where?.status).toBe("requires_review");
  });

  it("returns 400 if reason is missing from request body", async () => {
    mockFindUnique.mockResolvedValue(reviewRecord);
    const app = buildApp();
    const res = await request(app)
      .post("/admin/discovery/disc-1/reject")
      .set(
        "Authorization",
        `Bearer ${process.env.ADMIN_API_KEY ?? "test-admin-key"}`,
      )
      .send({}); // no reason

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("reason_required");
  });
});
