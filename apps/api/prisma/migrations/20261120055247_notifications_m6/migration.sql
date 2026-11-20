-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "pushSent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pushSkipped" TEXT;

-- AlterTable
ALTER TABLE "push_subscriptions" ADD COLUMN     "lastError" TEXT;

-- CreateTable
CREATE TABLE "notification_settings" (
    "userId" UUID NOT NULL,
    "quietStart" TEXT,
    "quietEnd" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
