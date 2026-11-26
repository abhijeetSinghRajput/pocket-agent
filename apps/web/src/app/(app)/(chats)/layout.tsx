import type { ReactNode } from 'react';
import { ChatsLayout } from '@/components/agents/chats-layout';

/** `/chat` (chat list) and `/agents/<id>` (a chat) share one layout, so the list stays mounted on desktop. */
export default function ChatsGroupLayout({ children }: { children: ReactNode }) {
  return <ChatsLayout>{children}</ChatsLayout>;
}
