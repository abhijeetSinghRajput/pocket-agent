-- AlterTable
ALTER TABLE "commands" ADD COLUMN     "deviceId" UUID NOT NULL,
ALTER COLUMN "sessionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "observedInstructions" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "projects" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "commands_deviceId_status_idx" ON "commands"("deviceId", "status");

-- CreateIndex
CREATE INDEX "commands_status_expiresAt_idx" ON "commands"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "commands" ADD CONSTRAINT "commands_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
