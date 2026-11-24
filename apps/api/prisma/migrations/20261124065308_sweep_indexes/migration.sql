-- Indexes for the background sweeps: expiring pending approvals (by status and expiresAt) and
-- the retention job deleting old events (by createdAt).

-- CreateIndex
CREATE INDEX "agent_events_createdAt_idx" ON "agent_events"("createdAt");

-- CreateIndex
CREATE INDEX "approvals_status_expiresAt_idx" ON "approvals"("status", "expiresAt");
