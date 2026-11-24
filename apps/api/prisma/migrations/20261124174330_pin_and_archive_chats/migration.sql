-- AlterTable
ALTER TABLE "agent_sessions" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "pinnedAt" TIMESTAMP(3);
