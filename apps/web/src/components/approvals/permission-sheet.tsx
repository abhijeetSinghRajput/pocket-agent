'use client';

import { ApprovalResponse, type ApprovalDto } from '@pocket-agent/protocol';
import { Check, CheckCheck, Clock, X } from 'lucide-react';
import { useState } from 'react';
import { describeRequest, readableInput, useCountdown } from '@/components/approvals/approval-card';
import { Button } from '@/components/ui/button';
import { shellTokens } from '@/components/ui/command-line';
import { apiRequest } from '@/lib/api';
import { agentName, requestTarget } from '@/lib/chat';
import { mmss } from '@/lib/format';

/**
 * A permission request, docked at the bottom of the chat in place of the message box (like
 * Claude's questions): what the agent wants to do, exactly what will run, then Deny or Allow.
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
  // Allowing with "don't ask again in this session" (the PC offers it for some requests).
  const [forSession, setForSession] = useState(false);
  const what = describeRequest(approval.toolName);
  const shown = requestTarget(approval.toolName, approval.input) || readableInput(approval.input);

  async function decide(decision: 'allow' | 'deny', remember = false) {
    setBusy(decision);
    setForSession(remember);
    setError(null);
    try {
      await apiRequest(`/approvals/${approval.id}/decision`, ApprovalResponse, {
        method: 'POST',
        body: { decision, ...(remember ? { remember: true } : {}) },
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
        <p className="mt-1.5 text-lg leading-snug font-semibold text-pretty">
          {agentName(approval.provider)} wants to {what.verb}
        </p>
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
            <Check aria-hidden /> {busy === 'allow' && !forSession ? 'Allowing…' : 'Allow'}
          </Button>
        </div>
        {/* As in the app: allow it, and Claude Code stops asking for this in the chat. */}
        {approval.remember && (
          <button
            type="button"
            data-testid="allow-session"
            aria-label={`Allow for this session: ${approval.remember}`}
            disabled={!!busy || expired}
            onClick={() => void decide('allow', true)}
            className="flex w-full flex-col items-start gap-0.5 rounded-xl border border-success/45 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-success/8 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] disabled:opacity-50"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCheck className="size-4" strokeWidth={2.4} aria-hidden />
              {busy === 'allow' && forSession ? 'Allowing for this session…' : 'Allow for this session'}
            </span>
            <span className="line-clamp-2 text-xs text-muted-foreground">
              Won’t ask again for: {approval.remember}
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
