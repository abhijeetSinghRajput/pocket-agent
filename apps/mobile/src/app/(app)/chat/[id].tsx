import { useLocalSearchParams } from 'expo-router';
import { ChatScreen } from '@/features/chat/chat-screen';

export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatScreen id={id} />;
}

/** A screen that fails to draw shows a way out instead of closing the app. */
export { CrashScreen as ErrorBoundary } from '@/ui/crash';
