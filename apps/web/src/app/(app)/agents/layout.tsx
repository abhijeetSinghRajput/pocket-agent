import type { ReactNode } from 'react';
import { ChatsLayout } from '@/components/agents/chats-layout';

export default function AgentsLayout({ children }: { children: ReactNode }) {
  return <ChatsLayout>{children}</ChatsLayout>;
}
