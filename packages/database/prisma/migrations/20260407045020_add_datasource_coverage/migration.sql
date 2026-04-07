-- AlterTable
ALTER TABLE "data_sources" ADD COLUMN     "coveragePolygon" JSONB,
ADD COLUMN     "coverageRegion" TEXT,
ADD COLUMN     "coverageType" TEXT;
