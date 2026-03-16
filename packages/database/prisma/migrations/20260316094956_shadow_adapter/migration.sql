-- AlterTable
ALTER TABLE "api_availability" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "providerType" TEXT,
ADD COLUMN     "shadowDiscovered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceUrl" TEXT;
