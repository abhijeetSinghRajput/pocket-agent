'use client';

import { ApprovalResponse, type ApprovalDto } from '@pocket-agent/protocol';
import { Check, Clock, X } from 'lucide-react';
import { useState } from 'react';
import { describeRequest, readableInput, useCountdown } from '@/components/approvals/approval-card';
import { Button } from '@/components/ui/button';
import { shellTokens } from '@/components/ui/command-line';
import { apiRequest } from '@/lib/api';
import { toolTarget } from '@/lib/chat';
import { mmss } from '@/lib/format';

/**
 * A permission request, docked at the bottom of the chat in place of the message box (like
 * Claude's questions): what Claude wants to do, exactly what will run, then Deny or Allow.
 */
export function PermissionSheet({
  approval,
  more,
  onDone,
}: {
  approval: ApprovalDto;
  /** How many other requests wait after this one. */
  more: number;
  onDone: () => void;
}) {
  const left = useCountdown(approval.expiresAt);
  const expired = left <= 0;
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const what = describeRequest(approval.toolName);
  const shown = toolTarget(approval.input) || readableInput(approval.input);

  async function decide(decision: 'allow' | 'deny') {
    setBusy(decision);
    setError(null);
    try {
      await apiRequest(`/approvals/${approval.id}/decision`, ApprovalResponse, {
        method: 'POST',
        body: { decision },
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <section
      aria-label="Permission needed"
      data-testid="permission-sheet"
      data-request-id={approval.requestId}
      className="sheet-in flex max-h-[70dvh] flex-col overflow-hidden rounded-t-3xl border-t-[3px] border-warning bg-popover"
    >
      <div className="flex flex-col overflow-y-auto px-4 pt-4 pb-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold tracking-wide text-warning uppercase">
            Permission needed{more > 0 ? ` · ${more} more waiting` : ''}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
            <Clock className="size-3.5 text-warning" aria-hidden />
            {expired ? (
              'Expired'
            ) : (
              <>
                <span className="font-semibold text-foreground">{mmss(left)}</span> left
              </>
            )}
          </span>
        </div>
        <p className="mt-1.5 text-lg leading-snug font-semibold text-pretty">Claude wants to {what.verb}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {what.label} · {approval.toolName}
        </p>
        {/* Exactly what will run: the decision applies to this, unchanged. */}
        <pre className="mt-3 max-h-[40dvh] overflow-auto rounded-2xl border bg-card px-4 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {what.shell
            ? shellTokens(shown).map((t, i) => (
                <span key={i} className={t.cls}>
                  {t.text}
                </span>
              ))
            : shown}
        </pre>
      </div>
      <div className="flex flex-col gap-3 px-4 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <p className="text-xs text-muted-foreground">
          {approval.sessionMode === 'managed'
            ? 'If nobody decides in time, it is denied.'
            : 'If nobody decides in time, Claude Code asks on your PC instead.'}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="h-12 rounded-xl bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={!!busy || expired}
            onClick={() => void decide('deny')}
          >
            <X aria-hidden /> {busy === 'deny' ? 'Denying…' : 'Deny'}
          </Button>
          <Button
            className="h-12 rounded-xl"
            disabled={!!busy || expired}
            onClick={() => void decide('allow')}
          >
            <Check aria-hidden /> {busy === 'allow' ? 'Allowing…' : 'Allow'}
          </Button>
        </div>
      </div>
    </section>
  );
}
