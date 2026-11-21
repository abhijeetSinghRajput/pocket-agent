'use client';

import { Laptop, Lock, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { APPROVAL_STATUS, ApprovalCard } from '@/components/approvals/approval-card';
import { toolTarget } from '@/lib/chat';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TerminalGuide } from '@/components/ui/terminal-guide';
import { timeAgo } from '@/lib/format';
import { useApprovals } from '@/lib/use-approvals';

export function ApprovalsView() {
  const pending = useApprovals('pending');
  const history = useApprovals('all');
  const refreshAll = () => {
    void pending.refresh();
    void history.refresh();
  };
  const open = pending.state.data ?? [];
  const recent = (history.state.data ?? []).filter((a) => a.status !== 'Pending' || a.decision);

  return (
    <>
      <PageHeader title="Approvals" description="Permission requests waiting for your decision." />

      {pending.state.status === 'loading' && (
        <div className="h-40 animate-pulse rounded-xl bg-muted" aria-busy="true" />
      )}
      {pending.state.status === 'error' && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {pending.state.error}
        </p>
      )}

      {pending.state.status === 'ready' && open.length === 0 && (
        <section
          className="stagger flex flex-col gap-4 rounded-2xl bg-card p-4 sm:p-5"
          data-testid="no-approvals"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-success/12 text-success">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold">No requests waiting</h2>
              <p className="text-sm text-muted-foreground">Claude’s permission requests show up here.</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">1. Allow it once on your PC</p>
            <TerminalGuide steps={[{ command: 'pocket-agent approvals enable', output: 'Enabled.' }]} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <span className="font-medium">2. Turn on Away mode</span>{' '}
              <span className="text-muted-foreground">for sessions you start in your editor.</span>
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/devices">
                <Laptop aria-hidden /> Devices
              </Link>
            </Button>
          </div>

          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            Your Claude Code permission settings are never changed.
          </p>
        </section>
      )}

      {open.length > 0 && (
        <div className="stagger grid gap-3 md:grid-cols-2" aria-label="Pending approvals" data-enter-new="">
          {open.map((a) => (
            <ApprovalCard key={a.id} approval={a} onDecided={refreshAll} />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Recent</h2>
          <ul className="stagger divide-y rounded-xl bg-card" data-testid="approval-history">
            {recent.slice(0, 20).map((a) => {
              const s = APPROVAL_STATUS[a.status];
              const label = a.status === 'Pending' && a.decision ? 'Sent to PC' : s.label;
              return (
                <li
                  key={a.id}
                  className="flex items-start justify-between gap-3 px-4 py-3"
                  data-status={a.status}
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[13px]">{toolTarget(a.input) || a.toolName}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.toolName} · {a.projectName} · {timeAgo(a.createdAt)}
                    </p>
                  </div>
                  <Badge variant={s.tone} className="shrink-0">
                    {label}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
