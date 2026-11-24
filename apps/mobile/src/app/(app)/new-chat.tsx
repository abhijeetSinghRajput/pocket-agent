import { useLocalSearchParams } from 'expo-router';
import { NewChatScreen } from '@/features/chat/new-chat-screen';

export default function NewChatRoute() {
  const { deviceId, path, name } = useLocalSearchParams<{ deviceId: string; path: string; name: string }>();
  return <NewChatScreen deviceId={deviceId} path={path} name={name} />;
}
