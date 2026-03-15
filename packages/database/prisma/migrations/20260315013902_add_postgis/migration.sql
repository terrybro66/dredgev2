-- CreateTable
CREATE TABLE "weather_results" (
    "id" TEXT NOT NULL,
    "query_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "temperature_max" DOUBLE PRECISION,
    "temperature_min" DOUBLE PRECISION,
    "precipitation" DOUBLE PRECISION,
    "wind_speed" DOUBLE PRECISION,
    "description" TEXT,
    "raw" JSONB,

    CONSTRAINT "weather_results_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "weather_results" ADD CONSTRAINT "weather_results_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "query"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
