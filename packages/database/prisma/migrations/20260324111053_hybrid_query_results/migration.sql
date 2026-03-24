-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('rest', 'csv', 'xlsx', 'pdf', 'scrape');

-- CreateEnum
CREATE TYPE "RefreshPolicy" AS ENUM ('realtime', 'daily', 'weekly', 'static');

-- CreateEnum
CREATE TYPE "DiscoveredBy" AS ENUM ('manual', 'catalogue', 'serp', 'browser');

-- CreateTable
CREATE TABLE "DataSource" (
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

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "query_results" (
    "id" TEXT NOT NULL,
    "domain_name" TEXT NOT NULL,
    "source_tag" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "location" TEXT,
    "description" TEXT,
    "category" TEXT,
    "value" DOUBLE PRECISION,
    "raw" JSONB,
    "extras" JSONB,
    "snapshot_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_results_pkey" PRIMARY KEY ("id")
);
