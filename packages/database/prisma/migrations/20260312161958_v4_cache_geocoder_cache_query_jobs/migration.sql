/*
  Warnings:

  - You are about to drop the `CrimeResult` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Query` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SchemaVersion` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "CrimeResult" DROP CONSTRAINT "CrimeResult_query_id_fkey";

-- DropTable
DROP TABLE "CrimeResult";

-- DropTable
DROP TABLE "Query";

-- DropTable
DROP TABLE "SchemaVersion";

-- CreateTable
CREATE TABLE "query" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "date_from" TEXT NOT NULL,
    "date_to" TEXT NOT NULL,
    "poly" TEXT NOT NULL,
    "viz_hint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "domain" TEXT NOT NULL DEFAULT 'crime-uk',
    "resolved_location" TEXT,
    "country_code" TEXT,

    CONSTRAINT "query_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crime_results" (
    "id" TEXT NOT NULL,
    "query_id" TEXT NOT NULL,
    "persistent_id" TEXT,
    "category" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "street" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "outcome_category" TEXT,
    "outcome_date" TEXT,
    "location_type" TEXT,
    "context" TEXT,
    "raw" JSONB,

    CONSTRAINT "crime_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schema_version" (
    "id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "column_name" TEXT NOT NULL,
    "column_type" TEXT NOT NULL,
    "triggered_by" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "domain" TEXT NOT NULL DEFAULT 'crime-uk',

    CONSTRAINT "schema_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "query_cache" (
    "id" TEXT NOT NULL,
    "query_hash" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "result_count" INTEGER NOT NULL,
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geocoder_cache" (
    "id" TEXT NOT NULL,
    "place_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "country_code" TEXT NOT NULL,
    "poly" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geocoder_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "query_jobs" (
    "id" TEXT NOT NULL,
    "query_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "domain" TEXT NOT NULL,
    "cache_hit" BOOLEAN NOT NULL DEFAULT false,
    "rows_inserted" INTEGER NOT NULL DEFAULT 0,
    "parse_ms" INTEGER,
    "geocode_ms" INTEGER,
    "fetch_ms" INTEGER,
    "store_ms" INTEGER,
    "error_message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "query_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "query_cache_query_hash_key" ON "query_cache"("query_hash");

-- CreateIndex
CREATE UNIQUE INDEX "geocoder_cache_place_name_key" ON "geocoder_cache"("place_name");

-- AddForeignKey
ALTER TABLE "crime_results" ADD CONSTRAINT "crime_results_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "query"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "query_jobs" ADD CONSTRAINT "query_jobs_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "query"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
