import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "./db";

export const workspaceRouter = Router();

// Extend Request to carry userId injected by auth middleware
interface AuthRequest extends Request {
  userId?: string;
}

// ── POST /workspaces ──────────────────────────────────────────────────────────

workspaceRouter.post("/", async (req: AuthRequest, res: Response) => {
  const body = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "name is required" });

  const userId = req.userId ?? "anonymous";

  const workspace = await prisma.workspace.create({
    data: { name: body.data.name, ownerId: userId },
  });

  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId, role: "owner" },
  });

  return res.status(201).json(workspace);
});

// ── GET /workspaces ───────────────────────────────────────────────────────────

workspaceRouter.get("/", async (req: AuthRequest, res: Response) => {
  const userId = req.userId ?? "anonymous";

  const workspaces = await prisma.workspace.findMany({
    where: {
      members: { some: { userId } },
    },
  });

  return res.json(workspaces);
});

// ── POST /workspaces/:id/queries ──────────────────────────────────────────────

workspaceRouter.post(
  "/:id/queries",
  async (req: AuthRequest, res: Response) => {
    const userId = req.userId ?? "anonymous";
    const workspaceId = req.params.id;

    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });
    if (!member) return res.status(403).json({ error: "not a member" });

    const body = z
      .object({
        queryId: z.string().min(1),
        snapshotId: z.string().optional(),
        title: z.string().optional(),
        notes: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ error: "queryId is required" });

    const wq = await prisma.workspaceQuery.create({
      data: {
        workspaceId,
        queryId: body.data.queryId,
        snapshotId: body.data.snapshotId,
        title: body.data.title,
        notes: body.data.notes,
      },
    });

    return res.status(201).json(wq);
  },
);

// ── POST /workspaces/:id/annotations ─────────────────────────────────────────

workspaceRouter.post(
  "/:id/annotations",
  async (req: AuthRequest, res: Response) => {
    const userId = req.userId ?? "anonymous";
    const workspaceId = req.params.id;

    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });
    if (!member) return res.status(403).json({ error: "not a member" });

    const body = z
      .object({
        queryId: z.string().min(1),
        body: z.string().min(1),
      })
      .safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ error: "queryId and body are required" });

    const annotation = await prisma.annotation.create({
      data: {
        queryId: body.data.queryId,
        userId,
        body: body.data.body,
      },
    });

    return res.status(201).json(annotation);
  },
);
