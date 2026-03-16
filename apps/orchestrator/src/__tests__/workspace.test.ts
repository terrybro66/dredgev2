import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    workspace: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    workspaceMember: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    workspaceQuery: {
      create: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    annotation: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../db", () => ({ prisma: mockPrisma }));

let workspaceRouter: any;
beforeAll(async () => {
  ({ workspaceRouter } = await import("../workspace"));
});

function buildApp() {
  const app = express();
  app.use(express.json());
  // Inject a mock user for all requests
  app.use((req: any, _res: any, next: any) => {
    req.userId = "user-1";
    next();
  });
  app.use("/workspaces", workspaceRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /workspaces", () => {
  it("creates a workspace and adds owner as member", async () => {
    mockPrisma.workspace.create.mockResolvedValue({
      id: "ws-1",
      name: "My Workspace",
      ownerId: "user-1",
    });
    mockPrisma.workspaceMember.create.mockResolvedValue({});

    const app = buildApp();
    const res = await request(app)
      .post("/workspaces")
      .send({ name: "My Workspace" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("ws-1");
    expect(mockPrisma.workspaceMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "owner" }),
      }),
    );
  });

  it("returns 400 when name is missing", async () => {
    const app = buildApp();
    const res = await request(app).post("/workspaces").send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /workspaces", () => {
  it("returns workspaces for the current user", async () => {
    mockPrisma.workspace.findMany.mockResolvedValue([
      { id: "ws-1", name: "My Workspace", ownerId: "user-1" },
    ]);

    const app = buildApp();
    const res = await request(app).get("/workspaces");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("ws-1");
  });
});

describe("POST /workspaces/:id/queries", () => {
  it("pins a query to a workspace with a snapshotId", async () => {
    mockPrisma.workspaceMember.findFirst.mockResolvedValue({ role: "owner" });
    mockPrisma.workspaceQuery.create.mockResolvedValue({
      id: "wq-1",
      workspaceId: "ws-1",
      queryId: "query-1",
      snapshotId: "snap-1",
    });

    const app = buildApp();
    const res = await request(app)
      .post("/workspaces/ws-1/queries")
      .send({ queryId: "query-1", snapshotId: "snap-1", title: "My query" });

    expect(res.status).toBe(201);
    expect(res.body.snapshotId).toBe("snap-1");
  });

  it("returns 403 when user is not a workspace member", async () => {
    mockPrisma.workspaceMember.findFirst.mockResolvedValue(null);

    const app = buildApp();
    const res = await request(app)
      .post("/workspaces/ws-1/queries")
      .send({ queryId: "query-1", snapshotId: "snap-1" });

    expect(res.status).toBe(403);
  });
});

describe("POST /workspaces/:id/annotations", () => {
  it("creates an annotation on a query", async () => {
    mockPrisma.workspaceMember.findFirst.mockResolvedValue({ role: "viewer" });
    mockPrisma.annotation.create.mockResolvedValue({
      id: "ann-1",
      queryId: "query-1",
      userId: "user-1",
      body: "Interesting spike here",
    });

    const app = buildApp();
    const res = await request(app)
      .post("/workspaces/ws-1/annotations")
      .send({ queryId: "query-1", body: "Interesting spike here" });

    expect(res.status).toBe(201);
    expect(res.body.body).toBe("Interesting spike here");
  });

  it("returns 400 when body is missing", async () => {
    mockPrisma.workspaceMember.findFirst.mockResolvedValue({ role: "viewer" });

    const app = buildApp();
    const res = await request(app)
      .post("/workspaces/ws-1/annotations")
      .send({ queryId: "query-1" });

    expect(res.status).toBe(400);
  });
});
