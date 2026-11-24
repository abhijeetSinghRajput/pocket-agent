import { useLocalSearchParams } from 'expo-router';
import { AgentDetailScreen } from '@/features/agents/agent-detail';

export default function AgentRoute() {
  const { sessionId, toolUseId } = useLocalSearchParams<{ sessionId: string; toolUseId: string }>();
  return <AgentDetailScreen sessionId={sessionId} toolUseId={toolUseId} />;
}

/** A screen that fails to draw shows a way out instead of closing the app. */
export { CrashScreen as ErrorBoundary } from '@/ui/crash';
