-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "health" JSONB;

-- CreateTable
CREATE TABLE "pairing_requests" (
    "id" UUID NOT NULL,
    "pollTokenHash" TEXT NOT NULL,
    "check" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userId" UUID,
    "approvedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "deviceId" UUID,

    CONSTRAINT "pairing_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pairing_requests_pollTokenHash_key" ON "pairing_requests"("pollTokenHash");

-- CreateIndex
CREATE INDEX "pairing_requests_expiresAt_idx" ON "pairing_requests"("expiresAt");

-- AddForeignKey
ALTER TABLE "pairing_requests" ADD CONSTRAINT "pairing_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
