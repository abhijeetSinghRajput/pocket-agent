'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AgentsView } from '@/components/agents/agents-view';
import { openChatId } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * Messenger layout: on desktop the session list stays on the left and the open chat fills the right;
 * on phones the list and the chat are separate full screens.
 */
export function ChatsLayout({ children }: { children: ReactNode }) {
  const chatId = openChatId(usePathname());
  return (
    <div className="lg:grid lg:h-dvh lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
      <div className={cn('bg-card lg:block lg:min-h-0 lg:border-r', chatId && 'hidden')}>
        <AgentsView activeId={chatId} />
      </div>
      <div
        key={chatId ?? 'none'}
        className={cn('min-w-0 lg:min-h-0', chatId ? 'chat-enter' : 'hidden content-in lg:block')}
      >
        {children}
      </div>
    </div>
  );
}
