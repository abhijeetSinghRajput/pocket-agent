import type { Metadata } from 'next';
import { AgentsPage } from '@/components/agents/agents-page';

export const metadata: Metadata = { title: 'Agents' };

/** The Agents tab, as in the app: Connected, Sub-agents, Finished. (A chat is `/agents/<id>`.) */
export default function AgentsRoute() {
  return <AgentsPage />;
}
