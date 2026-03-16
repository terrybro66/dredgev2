-- CreateTable
CREATE TABLE "domain_discovery" (
    "id" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "candidates" JSONB,
    "proposed_config" JSONB,
    "sample_rows" JSONB,
    "confidence" DOUBLE PRECISION,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "domain_discovery_pkey" PRIMARY KEY ("id")
);
