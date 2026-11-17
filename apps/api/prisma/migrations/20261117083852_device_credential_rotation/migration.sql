-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "pendingSecretHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "devices_pendingSecretHash_key" ON "devices"("pendingSecretHash");
