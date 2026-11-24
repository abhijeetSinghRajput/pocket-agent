import { SessionResponse, type AgentSessionDto } from '@pocket-agent/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Pin, PinOff, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { apiRequest } from '@/lib/api';
import { radius, useTheme } from '@/lib/theme';
import { buzz, Press, T } from '@/ui/core';
import { Notice } from '@/ui/feedback';
import { Sheet } from '@/ui/sheet';

/** Pins or archives a chat (on the server: every device sees it), then refreshes the lists. */
export function useOrganize() {
  const client = useQueryClient();
  return async (id: string, change: { pinned?: boolean; archived?: boolean }) => {
    await apiRequest(`/sessions/${id}/organize`, SessionResponse, { method: 'POST', body: change });
    await client.invalidateQueries({ queryKey: ['sessions'] });
  };
}

function Action({
  icon: Icon,
  label,
  hint,
  onPress,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  onPress: () => void;
  testID: string;
}) {
  const { c } = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      scale={0.98}
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 12,
        paddingVertical: 14,
        borderRadius: radius.lg,
      }}
    >
      <Icon size={20} color={c.foreground} strokeWidth={2} />
      <View style={{ flex: 1 }}>
        <T variant="bodyMedium">{label}</T>
        <T variant="caption" tone="muted">
          {hint}
        </T>
      </View>
    </Press>
  );
}

/** A chat's long-press menu: pin it to the top, or archive it out of the list. */
export function ChatActions({ chat, onClose }: { chat: AgentSessionDto | null; onClose: () => void }) {
  const organize = useOrganize();
  const [error, setError] = useState<string | null>(null);

  async function run(change: { pinned?: boolean; archived?: boolean }) {
    if (!chat) return;
    setError(null);
    try {
      await organize(chat.id, change);
      buzz(true);
      onClose();
    } catch (err) {
      buzz(false);
      setError((err as Error).message);
    }
  }

  return (
    <Sheet open={!!chat} onClose={onClose} title={chat?.projectName} description={chat?.deviceName}>
      {chat && (
        <View style={{ gap: 2 }}>
          {!chat.archived &&
            (chat.pinned ? (
              <Action
                icon={PinOff}
                label="Unpin"
                hint="Back among the others, by latest activity."
                onPress={() => void run({ pinned: false })}
                testID="chat-unpin"
              />
            ) : (
              <Action
                icon={Pin}
                label="Pin to top"
                hint="Stays at the top of your chats."
                onPress={() => void run({ pinned: true })}
                testID="chat-pin"
              />
            ))}
          {chat.archived ? (
            <Action
              icon={ArchiveRestore}
              label="Unarchive"
              hint="Back in your chats."
              onPress={() => void run({ archived: false })}
              testID="chat-unarchive"
            />
          ) : (
            <Action
              icon={Archive}
              label="Archive"
              hint="Out of your chats, into Archived. Nothing is deleted."
              onPress={() => void run({ archived: true })}
              testID="chat-archive"
            />
          )}
          {error && <Notice>{error}</Notice>}
        </View>
      )}
    </Sheet>
  );
}
