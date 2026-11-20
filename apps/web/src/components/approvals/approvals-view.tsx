'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { APPROVAL_STATUS, ApprovalCard } from '@/components/approvals/approval-card';
import { toolTarget } from '@/components/agents/timeline';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
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
          className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center"
          data-testid="no-approvals"
        >
          <span className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <h2 className="mt-4 text-base font-semibold">Nothing waiting</h2>
          <div className="mt-2 max-w-md space-y-2 text-sm text-pretty text-muted-foreground">
            <p>
              Remote approval is off until you enable it on the PC:{' '}
              <code className="font-mono text-[13px] text-foreground">
                pnpm pocket-agent approvals enable
              </code>
              . For sessions you start yourself, requests come here only while{' '}
              <Link href="/devices" className="font-medium text-foreground underline underline-offset-4">
                Away mode
              </Link>{' '}
              is on.
            </p>
            <p>
              Pocket Agent never changes your Claude Code permission settings, and every decision is audited.
            </p>
          </div>
        </section>
      )}

      {open.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2" aria-label="Pending approvals">
          {open.map((a) => (
            <ApprovalCard key={a.id} approval={a} onDecided={refreshAll} />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Recent</h2>
          <ul className="divide-y rounded-xl border bg-card" data-testid="approval-history">
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
