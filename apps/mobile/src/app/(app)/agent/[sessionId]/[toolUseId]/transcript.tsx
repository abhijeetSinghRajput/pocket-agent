import { useLocalSearchParams } from 'expo-router';
import { AgentTranscriptScreen } from '@/features/agents/agent-transcript';

export default function AgentTranscriptRoute() {
  const { sessionId, toolUseId } = useLocalSearchParams<{ sessionId: string; toolUseId: string }>();
  return <AgentTranscriptScreen sessionId={sessionId} toolUseId={toolUseId} />;
}

/** A screen that fails to draw shows a way out instead of closing the app. */
export { CrashScreen as ErrorBoundary } from '@/ui/crash';
