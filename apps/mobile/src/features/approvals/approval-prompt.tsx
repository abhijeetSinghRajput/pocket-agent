import { usePathname, useRouter } from 'expo-router';
import { MessageSquare } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { useApprovals } from '@/lib/data';
import { Button } from '@/ui/core';
import { Sheet } from '@/ui/sheet';
import { ApprovalCard } from './approval-card';

/** The session whose chat is open (`/chat/<id>`), if any. */
function openChatId(pathname: string): string | null {
  return /^\/chat\/([^/?#]+)\/?$/.exec(pathname)?.[1] ?? null;
}

/**
 * A permission request pops up wherever you are, the Agents tab included: this sheet is the one
 * place requests are asked. Inside that session's chat it is asked inline instead. "Later" only
 * hides it here; it stays pending in its chat until decided or expired.
 */
export function ApprovalPrompt() {
  const pathname = usePathname();
  const router = useRouter();
  const { state, refresh } = useApprovals('pending');
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const chatId = openChatId(pathname);
  const next = (state.data ?? []).find((a) => !dismissed.has(a.id) && a.sessionId !== chatId);
  const dismiss = (id: string) => setDismissed((d) => new Set(d).add(id));
  // The last one shown stays while the sheet slides away.
  const [shown, setShown] = useState(next);
  if (next && next !== shown) setShown(next);

  return (
    // No sheet title: the request's own header ("Claude wants to run a command") is the title.
    <Sheet open={!!next} onClose={() => next && dismiss(next.id)}>
      {shown && (
        <View testID="approval-prompt">
          <ApprovalCard
            key={shown.id}
            approval={shown}
            inSheet
            onDecided={() => {
              dismiss(shown.id);
              void refresh();
            }}
          />
          {/* The decision is the main thing; putting it off or going to the chat is quieter. */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginTop: 8,
              marginHorizontal: -8,
            }}
          >
            <Button
              label="Later"
              variant="ghost"
              size="sm"
              onPress={() => dismiss(shown.id)}
              testID="later"
            />
            <Button
              label="Open chat"
              icon={MessageSquare}
              variant="ghost"
              size="sm"
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
