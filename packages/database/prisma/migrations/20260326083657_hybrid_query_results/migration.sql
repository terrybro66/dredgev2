-- AlterTable
ALTER TABLE "data_sources" ADD COLUMN     "extrasSchema" JSONB;

-- AlterTable
ALTER TABLE "query_results" ADD COLUMN     "query_id" TEXT;

-- AddForeignKey
ALTER TABLE "query_results" ADD CONSTRAINT "query_results_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "query"("id") ON DELETE SET NULL ON UPDATE CASCADE;
