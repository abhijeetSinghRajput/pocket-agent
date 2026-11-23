import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { fonts, radius, useTheme, type Colors } from '@/lib/theme';

export interface ShellToken {
  text: string;
  /** Which syntax colour the token takes (none for whitespace). */
  kind?: 'program' | 'flag' | 'string' | 'subcommand' | 'value';
}

/**
 * Colours a one-line shell command with the same palette as code blocks: the program, its
 * subcommand, flags and values each get their own colour. Deterministic and instant (no parser),
 * the same rules as the web app's `shellTokens`.
 */
export function shellTokens(command: string): ShellToken[] {
  const out: ShellToken[] = [];
  let word = 0;
  for (const part of command.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      out.push({ text: part });
      continue;
    }
    let kind: ShellToken['kind'];
    if (word === 0) kind = 'program';
    else if (part.startsWith('-')) kind = 'flag';
    else if (/^(https?:\/\/|@|["'])/.test(part) || /[/\\]/.test(part)) kind = 'string';
    else if (word === 1) kind = 'subcommand';
    else kind = 'value';
    out.push({ text: part, kind });
    word++;
  }
  return out;
}

function tokenColor(c: Colors, kind: ShellToken['kind']): string {
  switch (kind) {
    case 'program':
      return c.hlTitle;
    case 'flag':
      return c.hlKeyword;
    case 'string':
      return c.hlString;
    case 'value':
      return c.hlNumber;
    default:
      return c.foreground;
  }
}

/** A shell command, coloured by token. Does not wrap: put it in a horizontal scroll when long. */
export function ShellText({ command, size = 13.5 }: { command: string; size?: number }) {
  const { c } = useTheme();
  return (
    <Text style={{ fontFamily: fonts.mono, fontSize: size, lineHeight: size * 1.5, color: c.foreground }}>
      {shellTokens(command).map((t, i) => (
        <Text
          key={i}
          style={{
            color: tokenColor(c, t.kind),
            fontFamily: t.kind === 'program' ? fonts.monoMedium : fonts.mono,
          }}
        >
          {t.text}
        </Text>
      ))}
    </Text>
  );
}

/**
 * Exactly what will run or be touched, in mono on a code surface. A shell command stays on its
 * line and scrolls sideways when long (as the web app does); anything else (a path, JSON) wraps
 * and scrolls down past `maxHeight`.
 */
export function CodeBlock({
  text,
  shell = false,
  maxHeight = 220,
  style,
  testID,
}: {
  text: string;
  shell?: boolean;
  maxHeight?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { c } = useTheme();
  const surface = {
    backgroundColor: c.code,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  };
  if (shell) {
    return (
      <View style={[surface, style]} testID={testID}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 11 }}
        >
          <ShellText command={text} />
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={[surface, { maxHeight }, style]} testID={testID}>
      <ScrollView
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 11 }}
      >
        <Text
          selectable
          style={{ fontFamily: fonts.mono, fontSize: 13.5, lineHeight: 20, color: c.foreground }}
        >
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}
