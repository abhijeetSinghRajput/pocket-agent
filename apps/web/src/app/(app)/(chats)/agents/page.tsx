import type { Metadata } from 'next';
import { NoChatSelected } from '@/components/agents/agents-view';

export const metadata: Metadata = { title: 'Agents' };

/** The session list lives in the layout; this is the empty right-hand pane on desktop. */
export default function AgentsPage() {
  return <NoChatSelected />;
}
