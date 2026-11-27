import type { Metadata } from 'next';
import { SubagentTranscript } from '@/components/agents/subagent-detail';

export const metadata: Metadata = { title: 'Transcript' };

/** A sub-agent's whole transcript, drawn like a chat. */
export default async function SubagentTranscriptPage({
  params,
}: {
  params: Promise<{ id: string; toolUseId: string }>;
}) {
  const { id, toolUseId } = await params;
  return <SubagentTranscript sessionId={id} toolUseId={decodeURIComponent(toolUseId)} />;
}
