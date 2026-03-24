-- AlterTable
ALTER TABLE "domain_discovery" ADD COLUMN     "ephemeral_rationale" TEXT,
ADD COLUMN     "refresh_policy" TEXT,
ADD COLUMN     "store_results" BOOLEAN;
