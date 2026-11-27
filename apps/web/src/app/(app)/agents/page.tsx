import type { Metadata } from 'next';
import { AgentsPage } from '@/components/agents/agents-page';

export const metadata: Metadata = { title: 'Agents' };

/** The Agents tab, as in the app: Connected, Sub-agents, Finished. (A chat is `/chat/<id>`; see routes in lib/nav.ts.) */
export default function AgentsRoute() {
  return <AgentsPage />;
}
