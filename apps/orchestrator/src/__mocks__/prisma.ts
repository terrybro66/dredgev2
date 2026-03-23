/**
 * Prisma singleton mock for Vitest.
 *
 * Location: apps/orchestrator/src/__mocks__/prisma.ts
 *
 * Import in every test file as:
 *   import { prismaMock } from "@mocks/prisma";
 *
 * The @mocks alias is defined in vitest.config.ts — see that file.
 * This works at any directory depth, including subdirectories like
 * __tests__/crime/, with no path changes needed.
 */

import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Helper — builds a mock delegate for one Prisma model.
// Every method returns undefined by default; tests override per-call.
// ---------------------------------------------------------------------------
function mockDelegate() {
  return {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Typed mock delegates — one per Prisma model used in the orchestrator.
// Add new models here as the schema grows.
// ---------------------------------------------------------------------------
export const prismaMock = {
  // Core domain / source models
  domainDiscovery: mockDelegate(),
  dataSource: mockDelegate(),

  // Execution model
  queryRun: mockDelegate(),
  datasetSnapshot: mockDelegate(),

  // Geocoder + cache
  geocoderCache: mockDelegate(),
  cacheEntry: mockDelegate(),

  // Workspaces
  workspace: mockDelegate(),
  savedQuery: mockDelegate(),

  // Availability tracking
  apiAvailability: mockDelegate(),

  // Job queue
  queryJob: mockDelegate(),

  // Prisma client lifecycle (tests may need to await $connect / $disconnect)
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $transaction: vi.fn((arg: unknown) => {
    // Support both the callback form and the array form.
    if (typeof arg === "function") {
      return (arg as (tx: unknown) => unknown)(prismaMock);
    }
    return Promise.all(arg as Promise<unknown>[]);
  }),
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
};

// ---------------------------------------------------------------------------
// Reset all mocks between tests.
// Call this from a beforeEach() in your test file, or register it globally in
// vitest.config.ts via setupFiles.
// ---------------------------------------------------------------------------
export function resetPrismaMocks() {
  const delegates = [
    "domainDiscovery",
    "dataSource",
    "queryRun",
    "datasetSnapshot",
    "geocoderCache",
    "cacheEntry",
    "workspace",
    "savedQuery",
    "apiAvailability",
    "queryJob",
  ] as const;

  for (const key of delegates) {
    for (const method of Object.keys(prismaMock[key])) {
      (prismaMock[key] as Record<string, ReturnType<typeof vi.fn>>)[
        method
      ].mockReset();
    }
  }

  prismaMock.$connect.mockReset().mockResolvedValue(undefined);
  prismaMock.$disconnect.mockReset().mockResolvedValue(undefined);
  prismaMock.$queryRaw.mockReset();
  prismaMock.$executeRaw.mockReset();
  prismaMock.$transaction.mockReset().mockImplementation((arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: unknown) => unknown)(prismaMock);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
}

// ---------------------------------------------------------------------------
// Mock the db module so imports of `prisma` in production code resolve to
// prismaMock automatically.  Vitest picks this up when the test file (or
// vitest.config.ts setupFiles) calls:
//
//   vi.mock("../db");          // or wherever db.ts lives relative to the test
//
// The __mocks__ auto-mock convention handles the prisma.ts file itself.
// ---------------------------------------------------------------------------
export default prismaMock;
