'use client';

import { ApprovalCard } from '@/components/approvals/approval-card';
import { useApprovals } from '@/lib/use-approvals';

/** Pending permission requests of one session, shown on top of its page. */
export function SessionApprovals({ sessionId }: { sessionId: string }) {
  const { state, refresh } = useApprovals('pending');
  // Claude's questions are answered in the question panel instead.
  const mine = (state.data ?? []).filter(
    (a) => a.sessionId === sessionId && a.toolName !== 'AskUserQuestion',
  );
  if (!mine.length) return null;
  return (
    <div className="flex flex-col gap-3 lg:col-start-1" aria-label="Waiting for your decision">
      {mine.map((a) => (
        <ApprovalCard key={a.id} approval={a} onDecided={() => void refresh()} />
      ))}
    </div>
  );
}
