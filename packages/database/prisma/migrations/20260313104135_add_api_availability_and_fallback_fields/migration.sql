-- AlterTable
ALTER TABLE "query_jobs" ADD COLUMN     "fallback_applied" TEXT,
ADD COLUMN     "fallback_success" BOOLEAN;

-- CreateTable
CREATE TABLE "api_availability" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "months" TEXT[],
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_availability_source_key" ON "api_availability"("source");
