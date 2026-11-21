-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "models" JSONB NOT NULL DEFAULT '[]';
