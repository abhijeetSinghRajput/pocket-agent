import { usePathname, useRouter } from 'expo-router';
import { MessageSquare } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { useApprovals } from '@/lib/data';
import { Button } from '@/ui/core';
import { Sheet } from '@/ui/sheet';
import { ApprovalCard } from './approval-card';

/** The session whose chat is open (`/chat/<id>`), if any. */
function openChatId(pathname: string): string | null {
  return /^\/chat\/([^/?#]+)\/?$/.exec(pathname)?.[1] ?? null;
}

/**
 * A permission request pops up wherever you are. Inside that session's chat it is asked inline
 * instead, and on the Approvals tab it is already listed — so no sheet there.
 * "Later" only hides it here; it stays pending in Approvals until decided or expired.
 */
export function ApprovalPrompt() {
  const pathname = usePathname();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const { state, refresh } = useApprovals('pending');
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const chatId = openChatId(pathname);
  const onApprovalsPage = pathname === '/approvals';

  const next = onApprovalsPage
    ? undefined
    : (state.data ?? []).find((a) => !dismissed.has(a.id) && a.sessionId !== chatId);
  const dismiss = (id: string) => setDismissed((d) => new Set(d).add(id));
  // The last one shown stays while the sheet slides away.
  const [shown, setShown] = useState(next);
  if (next && next !== shown) setShown(next);

  const asking = shown?.toolName === 'AskUserQuestion';
  return (
    <Sheet
      open={!!next}
      onClose={() => next && dismiss(next.id)}
      title={asking ? 'Claude is asking you' : 'Permission needed'}
      description={asking ? 'Answer it here or in the chat.' : 'Claude is waiting for your decision.'}
    >
      {shown && (
        <View style={{ gap: 12 }} testID="approval-prompt">
          <ScrollView
            style={{ maxHeight: height * 0.55 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 2 }}
          >
            <ApprovalCard
              key={shown.id}
              approval={shown}
              onDecided={() => {
                dismiss(shown.id);
                void refresh();
              }}
            />
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Button label="Later" variant="outline" onPress={() => dismiss(shown.id)} testID="later" />
            <Button
              label="Open chat"
              icon={MessageSquare}
              variant="outline"
              onPress={() => {
                dismiss(shown.id);
                router.push({ pathname: '/chat/[id]', params: { id: shown.sessionId } });
              }}
              testID="open-chat"
            />
          </View>
        </View>
      )}
    </Sheet>
  );
}
