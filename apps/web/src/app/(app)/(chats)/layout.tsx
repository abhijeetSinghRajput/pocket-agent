import type { ReactNode } from 'react';
import { ChatsLayout } from '@/components/agents/chats-layout';

/** `/chat` (chat list) and `/chat/<id>/…` (a chat, its sub-agents) share one layout, so the list stays mounted on desktop. */
export default function ChatsGroupLayout({ children }: { children: ReactNode }) {
  return <ChatsLayout>{children}</ChatsLayout>;
}
