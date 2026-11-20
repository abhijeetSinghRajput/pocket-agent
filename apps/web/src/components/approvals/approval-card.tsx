'use client';

import { ApprovalResponse, type ApprovalDto } from '@pocket-agent/protocol';
import { Check, Clock, ShieldAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toolTarget } from '@/lib/chat';
import { Button } from '@/components/ui/button';
import { shellTokens } from '@/components/ui/command-line';
import { apiRequest } from '@/lib/api';
import { mmss, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

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

/** What the request is, in plain words. */
function describeRequest(tool: string): { verb: string; label: string; shell: boolean } {
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return { verb: 'run a command', label: 'Command', shell: true };
    case 'Write':
      return { verb: 'create or overwrite a file', label: 'File', shell: false };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { verb: 'edit a file', label: 'File', shell: false };
    case 'WebFetch':
      return { verb: 'open a web page', label: 'URL', shell: false };
    default:
      return { verb: `use ${tool}`, label: 'Details', shell: false };
  }
}

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

  const what = describeRequest(approval.toolName);
  const shown = target || approval.input;
  return (
    <article
      className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm"
      data-testid="approval-card"
      data-request-id={approval.requestId}
    >
      <header className="flex items-start gap-3 border-b bg-warning/8 px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-warning/20 text-warning">
          <ShieldAlert className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] leading-snug font-semibold">Claude wants to {what.verb}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <Link
              href={`/agents/${approval.sessionId}`}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {approval.projectName}
            </Link>{' '}
            · {approval.deviceName} · {timeAgo(approval.createdAt)}
          </p>
        </div>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
            expired ? 'bg-muted text-muted-foreground' : 'bg-warning/15 text-warning',
          )}
          aria-live="off"
          title="Time left to decide"
        >
          <Clock className="size-3" aria-hidden />
          {expired ? 'Expired' : mmss(left)}
        </span>
      </header>

      {/* Exactly what will run — the decision applies to this, unchanged. */}
      <div className="flex flex-col gap-1.5 px-4 py-3">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {what.label} · {approval.toolName}
        </p>
        <pre className="max-h-56 overflow-auto rounded-lg border bg-muted/40 px-3 py-2.5 font-mono text-[13px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {what.shell
            ? shellTokens(shown).map((t, i) => (
                <span key={i} className={t.cls}>
                  {t.text}
                </span>
              ))
            : shown}
        </pre>
        <p className="text-xs text-muted-foreground">
          {approval.sessionMode === 'managed'
            ? 'If nobody decides in time, it is denied.'
            : 'If nobody decides in time, Claude Code asks on your PC instead.'}
        </p>
      </div>

      <div className="border-t bg-muted/30 px-4 py-3">
        {sent ? (
          <p className="text-sm text-muted-foreground" role="status">
            {sent === 'allow' ? 'Allowed' : 'Denied'} — waiting for your PC to confirm…
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11 bg-card text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={!!busy || expired}
              onClick={() => void decide('deny')}
            >
              <X aria-hidden /> {busy === 'deny' ? 'Denying…' : 'Deny'}
            </Button>
            <Button className="h-11" disabled={!!busy || expired} onClick={() => void decide('allow')}>
              <Check aria-hidden /> {busy === 'allow' ? 'Allowing…' : 'Allow'}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
