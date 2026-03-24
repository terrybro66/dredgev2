import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../db";
import { registerDiscoveredDomain } from "../agent/registration";

export const adminRouter = Router();

// ── Auth guard ────────────────────────────────────────────────────────────────

function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "").trim();
  const expected = process.env.ADMIN_API_KEY;

  if (!token || !expected || token !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

adminRouter.use(requireAdminAuth);

// ── GET /admin/discovery ──────────────────────────────────────────────────────
// Lists all DomainDiscovery records with status: requires_review.

adminRouter.get("/discovery", async (_req: Request, res: Response) => {
  const records = await prisma.domainDiscovery.findMany({
    where: { status: "requires_review" },
    orderBy: { createdAt: "desc" },
  });

  return res.json(records);
});

// ── POST /admin/discovery/:id/approve ────────────────────────────────────────
// Applies optional overrides to proposed_config, triggers registration,
// and marks the record as registered on success.

adminRouter.post(
  "/discovery/:id/approve",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const overrides: Record<string, unknown> = req.body?.overrides ?? {};

    const record = await prisma.domainDiscovery.findUnique({ where: { id } });

    if (!record) {
      return res.status(404).json({ error: "not_found" });
    }

    if (record.status !== "requires_review") {
      return res.status(400).json({ error: "not_reviewable" });
    }

    // Merge overrides into proposed_config before passing to registration.
    const base = (record.proposed_config as Record<string, unknown>) ?? {};
    const proposedConfig = { ...base, ...overrides };

    try {
      const result = await registerDiscoveredDomain({
        discoveryId: id,
        proposedConfig,
        prisma,
      });

      await prisma.domainDiscovery.update({
        where: { id },
        data: { status: "registered" },
      });

      return res.json({
        domainName: result.domainName,
        path: result.path,
      });
    } catch (err: any) {
      return res.status(500).json({
        error: "registration_failed",
        message: err.message,
      });
    }
  },
);

// ── POST /admin/discovery/:id/reject ─────────────────────────────────────────
// Marks a record as rejected with a reason. Rejected records do not reappear
// in the review queue. The same intent can still create new discovery records.

adminRouter.post(
  "/discovery/:id/reject",
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body ?? {};

    if (!reason || typeof reason !== "string" || reason.trim() === "") {
      return res.status(400).json({ error: "reason_required" });
    }

    const record = await prisma.domainDiscovery.findUnique({ where: { id } });

    if (!record) {
      return res.status(404).json({ error: "not_found" });
    }

    await prisma.domainDiscovery.update({
      where: { id },
      data: {
        status: "rejected",
        error_message: reason,
      },
    });

    return res.json({ id, status: "rejected" });
  },
);
