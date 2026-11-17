-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('windows', 'macos', 'linux');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('Online', 'Offline', 'Revoked');

-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('managed', 'observed');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('Starting', 'Running', 'WaitingForInput', 'WaitingForPermission', 'Completed', 'Failed', 'Stopped', 'Disconnected');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('Pending', 'Delivered', 'Accepted', 'Executing', 'Completed', 'Failed', 'Expired');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('Pending', 'Approved', 'Denied', 'Expired', 'Cancelled');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'device', 'system');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairing_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "pairing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'Offline',
    "secretHash" TEXT NOT NULL,
    "remoteApprovalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "awayMode" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeatAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" "SessionMode" NOT NULL,
    "externalSessionId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "projectPath" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'Starting',
    "capabilities" JSONB NOT NULL,
    "metadata" JSONB,
    "currentTask" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_events" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "sessionId" UUID,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commands" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "commandType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "CommandStatus" NOT NULL DEFAULT 'Pending',
    "idempotencyKey" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "requestId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'Pending',
    "decisionMessage" TEXT,
    "decidedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "auth_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "pairing_codes_codeHash_key" ON "pairing_codes"("codeHash");

-- CreateIndex
CREATE INDEX "pairing_codes_userId_idx" ON "pairing_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "devices_secretHash_key" ON "devices"("secretHash");

-- CreateIndex
CREATE INDEX "devices_userId_idx" ON "devices"("userId");

-- CreateIndex
CREATE INDEX "agent_sessions_deviceId_status_idx" ON "agent_sessions"("deviceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_sessions_deviceId_externalSessionId_key" ON "agent_sessions"("deviceId", "externalSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_events_eventId_key" ON "agent_events"("eventId");

-- CreateIndex
CREATE INDEX "agent_events_sessionId_createdAt_idx" ON "agent_events"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_events_deviceId_createdAt_idx" ON "agent_events"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "commands_sessionId_createdAt_idx" ON "commands"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "commands_userId_idempotencyKey_key" ON "commands"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "approvals_userId_status_idx" ON "approvals"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_sessionId_requestId_key" ON "approvals"("sessionId", "requestId");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_category_key" ON "notification_preferences"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_token_key" ON "push_subscriptions"("token");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commands" ADD CONSTRAINT "commands_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commands" ADD CONSTRAINT "commands_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
