-- AlterTable: enrich "Job" with per-file metadata, granular processing state,
-- provider/model provenance, timing, and a parent->child (follow-up) relation.

ALTER TABLE "Job" ADD COLUMN "processingStage" TEXT;
ALTER TABLE "Job" ADD COLUMN "originalFileName" TEXT;
ALTER TABLE "Job" ADD COLUMN "contentType" TEXT;
ALTER TABLE "Job" ADD COLUMN "fileSizeBytes" INTEGER;
ALTER TABLE "Job" ADD COLUMN "provider" TEXT;
ALTER TABLE "Job" ADD COLUMN "model" TEXT;
ALTER TABLE "Job" ADD COLUMN "charactersExtracted" INTEGER;
ALTER TABLE "Job" ADD COLUMN "parentJobId" TEXT;
ALTER TABLE "Job" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "finishedAt" TIMESTAMP(3);

-- Backfill the file name for legacy rows from the last segment of the storage
-- key ("briefs/{userId}/{jobId}/{name}"), then enforce the NOT NULL contract.
UPDATE "Job"
SET "originalFileName" = split_part("inputStorageKey", '/', 4)
WHERE "originalFileName" IS NULL OR "originalFileName" = '';

ALTER TABLE "Job" ALTER COLUMN "originalFileName" SET NOT NULL;

-- Self-relation: a follow-up job links back to the extraction it extends.
CREATE INDEX "Job_parentJobId_idx" ON "Job"("parentJobId");

ALTER TABLE "Job" ADD CONSTRAINT "Job_parentJobId_fkey"
FOREIGN KEY ("parentJobId") REFERENCES "Job"("id")
ON DELETE SET NULL ON UPDATE CASCADE;