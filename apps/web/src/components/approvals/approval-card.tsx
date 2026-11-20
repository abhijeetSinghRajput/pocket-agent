'use client';

import { ApprovalResponse, type ApprovalDto } from '@agentdock/protocol';
import { Check, ShieldAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toolTarget } from '@/components/agents/timeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/api';
import { mmss, timeAgo } from '@/lib/format';

export const APPROVAL_STATUS: Record<
  ApprovalDto['status'],
  { label: string; tone: 'success' | 'danger' | 'neutral' | 'warning' | 'accent' }
> = {
  Pending: { label: 'Waiting', tone: 'warning' },
  Approved: { label: 'Allowed', tone: 'success' },
  Denied: { label: 'Denied', tone: 'danger' },
  Expired: { label: 'Expired', tone: 'neutral' },
  Cancelled: { label: 'Answered elsewhere', tone: 'neutral' },
};

function useCountdown(expiresAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Date.parse(expiresAt) - now;
}

/** One pending permission request, with everything needed to decide on a phone. */
export function ApprovalCard({ approval, onDecided }: { approval: ApprovalDto; onDecided: () => void }) {
  const left = useCountdown(approval.expiresAt);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<'allow' | 'deny' | null>(approval.decision);
  const target = toolTarget(approval.input);
  const expired = left <= 0;

  async function decide(decision: 'allow' | 'deny') {
    setBusy(decision);
    setError(null);
    try {
      await apiRequest(`/approvals/${approval.id}/decision`, ApprovalResponse, {
        method: 'POST',
        body: { decision },
      });
      setSent(decision);
      onDecided();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <article
      className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-card p-4 shadow-xs"
      data-testid="approval-card"
      data-request-id={approval.requestId}
    >
      <header className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning/15 text-warning">
          <ShieldAlert className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Claude wants to use {approval.toolName}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <Link href={`/agents/${approval.sessionId}`} className="underline-offset-4 hover:underline">
              {approval.projectName}
            </Link>{' '}
            · {approval.deviceName} · {timeAgo(approval.createdAt)}
          </p>
        </div>
        <Badge variant={expired ? 'neutral' : 'warning'} className="shrink-0 tabular-nums" aria-live="off">
          {expired ? 'Expired' : mmss(left)}
        </Badge>
      </header>

      {/* Exactly what will run — the decision applies to this, unchanged. */}
      <pre className="max-h-48 overflow-auto rounded-md bg-muted/70 px-3 py-2 font-mono text-[12.5px] break-all whitespace-pre-wrap">
        {target || approval.input}
      </pre>

      {sent ? (
        <p className="text-sm text-muted-foreground" role="status">
          {sent === 'allow' ? 'Allowed' : 'Denied'} — waiting for your PC to confirm…
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={!!busy || expired}
            onClick={() => void decide('deny')}
          >
            <X aria-hidden /> {busy === 'deny' ? 'Denying…' : 'Deny'}
          </Button>
          <Button disabled={!!busy || expired} onClick={() => void decide('allow')}>
            <Check aria-hidden /> {busy === 'allow' ? 'Allowing…' : 'Allow'}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {approval.sessionMode === 'managed'
          ? 'If nobody decides in time, the action is denied.'
          : 'If nobody decides in time, Claude Code asks on your PC instead.'}
      </p>
    </article>
  );
}
