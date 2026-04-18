/*
  Warnings:

  - You are about to drop the `crime_results` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `weather_results` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "crime_results" DROP CONSTRAINT "crime_results_query_id_fkey";

-- DropForeignKey
ALTER TABLE "weather_results" DROP CONSTRAINT "weather_results_query_id_fkey";

-- AlterTable
ALTER TABLE "query" ALTER COLUMN "domain" SET DEFAULT 'unknown';

-- AlterTable
ALTER TABLE "schema_version" ALTER COLUMN "domain" SET DEFAULT 'unknown';

-- DropTable
DROP TABLE "crime_results";

-- DropTable
DROP TABLE "weather_results";
