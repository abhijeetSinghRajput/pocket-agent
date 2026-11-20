'use client';

import { Laptop, Lock, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { APPROVAL_STATUS, ApprovalCard } from '@/components/approvals/approval-card';
import { toolTarget } from '@/lib/chat';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CommandLine } from '@/components/ui/command-line';
import { timeAgo } from '@/lib/format';
import { useApprovals } from '@/lib/use-approvals';

function Step({ n }: { n: number }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground tabular-nums">
      {n}
    </span>
  );
}

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
        <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6" data-testid="no-approvals">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-success/12 text-success">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold">No requests waiting</h2>
              <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
                When Claude needs permission for something, it appears here and you can allow or deny it from
                your phone.
              </p>
            </div>
          </div>

          <h3 className="mt-6 text-sm font-semibold">To get requests here</h3>
          <ol className="mt-3 flex flex-col gap-4 text-sm">
            <li className="flex gap-3">
              <Step n={1} />
              <div className="min-w-0 flex-1">
                <p>Allow it once on your PC:</p>
                <CommandLine command="pocket-agent approvals enable" className="mt-2" />
              </div>
            </li>
            <li className="flex gap-3">
              <Step n={2} />
              <div className="min-w-0 flex-1">
                <p>
                  For sessions you start in VS Code or a terminal, turn on <strong>Away mode</strong> for that
                  PC. Otherwise Claude Code simply asks on the PC.
                </p>
                <Button asChild variant="outline" size="sm" className="mt-2">
                  <Link href="/devices">
                    <Laptop aria-hidden /> Open Devices
                  </Link>
                </Button>
              </div>
            </li>
            <li className="flex gap-3">
              <Step n={3} />
              <p className="min-w-0 flex-1">Sessions you start from Pocket Agent always ask here.</p>
            </li>
          </ol>

          <p className="mt-6 flex items-start gap-2 border-t pt-4 text-xs text-muted-foreground">
            <Lock className="mt-px size-3.5 shrink-0" aria-hidden />
            Pocket Agent never changes your Claude Code permission settings, and every decision is audited.
          </p>
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
