import crypto from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateSnapshotOptions {
  queryId: string;
  sourceSet: string[];
  schemaVersion: string;
  rows: unknown[];
  prisma: any;
}

export interface SnapshotResult {
  runId: string;
  snapshotId: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// ── createSnapshot ────────────────────────────────────────────────────────────

export async function createSnapshot(
  opts: CreateSnapshotOptions,
): Promise<SnapshotResult> {
  const { queryId, sourceSet, schemaVersion, rows, prisma } = opts;

  const run = await prisma.queryRun.create({
    data: {
      queryId,
      sourceSet,
      schemaVersion,
      status: "pending",
    },
  });

  try {
    const checksum = sha256(JSON.stringify(rows));

    const snapshot = await prisma.datasetSnapshot.create({
      data: {
        queryRunId: run.id,
        rowCount: rows.length,
        checksum,
        rows,
      },
    });

    await prisma.queryRun.update({
      where: { id: run.id },
      data: { status: "complete" },
    });

    return { runId: run.id, snapshotId: snapshot.id };
  } catch (err) {
    await prisma.queryRun.update({
      where: { id: run.id },
      data: { status: "failed" },
    });
    throw err;
  }
}
