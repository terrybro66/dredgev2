/*
  Warnings:

  - You are about to drop the `DataSource` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "DataSource";

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "domainName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "extractionPrompt" TEXT,
    "fieldMap" JSONB NOT NULL,
    "refreshPolicy" "RefreshPolicy" NOT NULL,
    "storeResults" BOOLEAN NOT NULL DEFAULT true,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "discoveredBy" "DiscoveredBy" NOT NULL DEFAULT 'manual',
    "approvedAt" TIMESTAMP(3),
    "lastFetchedAt" TIMESTAMP(3),
    "lastRowCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_domainName_url_key" ON "data_sources"("domainName", "url");
