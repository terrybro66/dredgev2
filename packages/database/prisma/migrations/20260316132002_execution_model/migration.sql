-- CreateTable
CREATE TABLE "query_runs" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceSet" TEXT[],
    "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "query_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_snapshots" (
    "id" TEXT NOT NULL,
    "queryRunId" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dataset_snapshots_queryRunId_key" ON "dataset_snapshots"("queryRunId");

-- AddForeignKey
ALTER TABLE "dataset_snapshots" ADD CONSTRAINT "dataset_snapshots_queryRunId_fkey" FOREIGN KEY ("queryRunId") REFERENCES "query_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
