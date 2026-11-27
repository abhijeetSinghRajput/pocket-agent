import type { Metadata } from 'next';
import { SubagentDetail } from '@/components/agents/subagent-detail';

export const metadata: Metadata = { title: 'Agent' };

/** One sub-agent of a chat: its prompt, tool calls, the agents it started, its result. */
export default async function SubagentPage({ params }: { params: Promise<{ id: string; toolUseId: string }> }) {
  const { id, toolUseId } = await params;
  return <SubagentDetail sessionId={id} toolUseId={decodeURIComponent(toolUseId)} />;
}
