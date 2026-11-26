import type { Metadata } from 'next';
import { NoChatSelected } from '@/components/agents/agents-view';

export const metadata: Metadata = { title: 'Chats' };

/** Home: the chat list lives in the layout; this is the empty right-hand pane on desktop. */
export default function ChatsPage() {
  return <NoChatSelected />;
}
