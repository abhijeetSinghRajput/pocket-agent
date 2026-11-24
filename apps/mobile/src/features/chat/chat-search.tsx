import { ChevronDown, ChevronUp, X } from 'lucide-react-native';
import { TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { enter } from '@/lib/motion';
import { fonts, radius, useTheme } from '@/lib/theme';
import { IconButton, T, tap } from '@/ui/core';

/**
 * Searching in a chat, in place of its header: type, and the matches light up in the conversation;
 * the arrows go to older (up) and newer (down) ones. The count says which one is shown.
 */
export function ChatSearchBar({
  query,
  onQuery,
  count,
  index,
  onIndex,
  onClose,
}: {
  query: string;
  onQuery: (q: string) => void;
  count: number;
  /** The match shown, 0 = oldest. */
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const go = (i: number) => {
    if (i < 0 || i >= count) return;
    tap();
    onIndex(i);
  };
  const typed = query.trim().length >= 2;
  return (
    <Animated.View
      entering={enter.fade}
      testID="chat-search"
      style={{
        paddingTop: insets.top + 4,
        paddingBottom: 8,
        paddingHorizontal: 8,
        height: insets.top + 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: c.bar,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
      }}
    >
      <IconButton icon={X} label="Close search" tone="default" onPress={onClose} testID="chat-search-close" />
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          height: 40,
          borderRadius: radius.full,
          backgroundColor: c.muted,
          paddingLeft: 14,
          paddingRight: 10,
        }}
      >
        <TextInput
          autoFocus
          value={query}
          onChangeText={onQuery}
          placeholder="Search in this chat"
          placeholderTextColor={c.mutedForeground}
          selectionColor={c.primary}
          returnKeyType="search"
          onSubmitEditing={() => go(index - 1 >= 0 ? index - 1 : count - 1)}
          accessibilityLabel="Search in this chat"
          testID="chat-search-input"
          style={{
            flex: 1,
            fontFamily: fonts.regular,
            fontSize: 16,
            color: c.foreground,
            paddingVertical: 0,
          }}
        />
        {typed && (
          <T
            variant="caption"
            tone="muted"
            accessibilityLiveRegion="polite"
            style={{ fontVariant: ['tabular-nums'], marginLeft: 6 }}
            testID="chat-search-count"
          >
            {count ? `${index + 1} of ${count}` : 'None'}
          </T>
        )}
      </View>
      <View style={{ opacity: !count || index <= 0 ? 0.3 : 1 }}>
        <IconButton
          icon={ChevronUp}
          label="Older match"
          tone="default"
          disabled={!count || index <= 0}
          onPress={() => go(index - 1)}
          testID="chat-search-older"
        />
      </View>
      <View style={{ opacity: !count || index >= count - 1 ? 0.3 : 1 }}>
        <IconButton
          icon={ChevronDown}
          label="Newer match"
          tone="default"
          disabled={!count || index >= count - 1}
          onPress={() => go(index + 1)}
          testID="chat-search-newer"
        />
      </View>
    </Animated.View>
  );
}
