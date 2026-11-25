import { Stack } from 'expo-router';
import { InAppToasts } from '@/features/alerts/in-app-toasts';
import { ApprovalPrompt } from '@/features/approvals/approval-prompt';
import { AppGate } from '@/features/shell/app-gate';
import { PushBootstrap } from '@/features/shell/push-bootstrap';
import { UpdateNotice } from '@/features/shell/app-update';
import { LiveProvider } from '@/lib/live';
import { useTheme } from '@/lib/theme';
import { useWidgetSync } from '@/widget/sync';

/** Everything behind sign-in: live updates, the first-PC setup gate, then the app's screens. */
export default function AppLayout() {
  const { c } = useTheme();
  // The home-screen widget follows the usage numbers while the app is open.
  useWidgetSync();
  return (
    <LiveProvider>
      <AppGate>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="chat/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="new-chat" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen
            name="agent/[sessionId]/[toolUseId]/index"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="agent/[sessionId]/[toolUseId]/transcript"
            options={{ animation: 'slide_from_right' }}
          />
        </Stack>
        <InAppToasts />
        <ApprovalPrompt />
        <PushBootstrap />
        <UpdateNotice />
      </AppGate>
    </LiveProvider>
  );
}

/** A screen that fails to draw shows a way out instead of closing the app. */
export { CrashScreen as ErrorBoundary } from '@/ui/crash';
