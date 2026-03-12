-- CreateTable
CREATE TABLE "Query" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "date_from" TEXT NOT NULL,
    "date_to" TEXT NOT NULL,
    "poly" TEXT NOT NULL,
    "viz_hint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "domain" TEXT NOT NULL DEFAULT 'crime',
    "resolved_location" TEXT,

    CONSTRAINT "Query_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrimeResult" (
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

    CONSTRAINT "CrimeResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemaVersion" (
    "id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "column_name" TEXT NOT NULL,
    "column_type" TEXT NOT NULL,
    "triggered_by" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "domain" TEXT NOT NULL DEFAULT 'crime',

    CONSTRAINT "SchemaVersion_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CrimeResult" ADD CONSTRAINT "CrimeResult_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "Query"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
