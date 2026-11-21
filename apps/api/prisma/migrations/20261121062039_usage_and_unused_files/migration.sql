-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "usedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "usage" JSONB;
