CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "domain_embeddings" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "exampleQuery" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_embeddings_pkey" PRIMARY KEY ("id")
);