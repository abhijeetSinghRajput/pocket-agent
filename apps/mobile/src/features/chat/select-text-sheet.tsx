import * as Clipboard from 'expo-clipboard';
import { Copy } from 'lucide-react-native';
import { ScrollView, Text, useWindowDimensions } from 'react-native';
import { fonts, useTheme } from '@/lib/theme';
import { Button, buzz } from '@/ui/core';
import { Sheet } from '@/ui/sheet';

/** Markdown as it reads: no fences, emphasis marks, heading hashes or link targets. */
export function plainText(md: string): string {
  return md
    .split('\n')
    .filter((l) => !/^\s*```/.test(l))
    .map((l) => l.replace(/^\s{0,3}#{1,6}\s+/, ''))
    .join('\n')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * A message's whole text, to select any part of it. In the conversation each paragraph is its own
 * text, and Android can't select across them; here the message is one text, so a selection can run
 * from the first line to the last.
 */
export function SelectTextSheet({
  text,
  open,
  onClose,
}: {
  text: string;
  open: boolean;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { height } = useWindowDimensions();
  const plain = plainText(text);
  return (
    <Sheet open={open} onClose={onClose} title="Select text" description="Long-press to select, then copy.">
      <ScrollView
        style={{ maxHeight: height * 0.55 }}
        contentContainerStyle={{ paddingBottom: 12 }}
        testID="select-text"
      >
        <Text
          selectable
          selectionColor={c.primary}
          style={{ fontFamily: fonts.regular, fontSize: 15.25, lineHeight: 23, color: c.foreground }}
        >
          {plain}
        </Text>
      </ScrollView>
      <Button
        label="Copy all"
        icon={Copy}
        onPress={() => {
          // Android confirms a copy itself, so no toast of ours.
          void Clipboard.setStringAsync(plain)
            .then(() => buzz(true))
            .catch(() => undefined);
          onClose();
        }}
      />
    </Sheet>
  );
}
