-- AlterTable
ALTER TABLE "SigningSession"
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'pickup';
