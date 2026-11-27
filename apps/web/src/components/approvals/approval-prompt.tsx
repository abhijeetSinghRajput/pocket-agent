'use client';

import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ApprovalCard } from '@/components/approvals/approval-card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { openChatId, routes } from '@/lib/nav';
import { useApprovals } from '@/lib/use-approvals';

/**
 * A permission request pops up wherever you are. Inside that session's chat it is asked inline
 * instead, and on the Approvals page it is already listed — so no dialog there.
 * "Later" only hides it here; it stays pending in Approvals until decided or expired.
 */
export function ApprovalPrompt() {
  const pathname = usePathname();
  const { state, refresh } = useApprovals('pending');
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const chatId = openChatId(pathname);
  const onApprovalsPage = pathname === '/approvals';

  const next = onApprovalsPage
    ? undefined
    : (state.data ?? []).find((a) => !dismissed.has(a.id) && a.sessionId !== chatId);
  const dismiss = (id: string) => setDismissed((d) => new Set(d).add(id));

  return (
    <Modal
      open={!!next}
      onOpenChange={(open) => !open && next && dismiss(next.id)}
      title={next?.toolName === 'AskUserQuestion' ? 'Claude is asking you' : 'Permission needed'}
      description={
        next?.toolName === 'AskUserQuestion'
          ? 'Answer it here or in the chat.'
          : 'Claude is waiting for your decision.'
      }
    >
      {next && (
        <div className="flex flex-col gap-3" data-testid="approval-prompt">
          <ApprovalCard
            key={next.id}
            approval={next}
            onDecided={() => {
              dismiss(next.id);
              void refresh();
            }}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" onClick={() => dismiss(next.id)}>
              Later
            </Button>
            <Button asChild variant="outline">
              <Link href={routes.chat(next.sessionId)} onClick={() => dismiss(next.id)}>
                <MessageSquare aria-hidden /> Open chat
              </Link>
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
