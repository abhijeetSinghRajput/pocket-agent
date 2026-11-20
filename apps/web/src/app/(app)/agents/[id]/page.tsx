import type { Metadata } from 'next';
import { AgentDetail } from '@/components/agents/agent-detail';

export const metadata: Metadata = { title: 'Agent' };

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentDetail id={id} />;
}
