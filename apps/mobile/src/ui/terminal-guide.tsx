import * as Clipboard from 'expo-clipboard';
import { Check, Copy } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { dur, ease } from '@/lib/motion';
import { fonts, radius } from '@/lib/theme';
import { Fade, Press, tap } from '@/ui/core';

export interface TerminalStep {
  /** The command to run, exactly as it should be typed. */
  command: string;
  /** What the terminal answers (the real first line of that command's output). */
  output?: string;
}

const TYPE_MS = 26;
const AFTER_COMMAND_MS = 420;
const AFTER_OUTPUT_MS = 520;

/** A terminal is one dark surface in both themes (as on the web): its own small palette. */
const TERM = {
  bg: '#17171a',
  text: '#f1f1f3',
  dim: 'rgba(255, 255, 255, 0.6)',
  light: 'rgba(255, 255, 255, 0.25)',
  bar: 'rgba(255, 255, 255, 0.09)',
  path: '#6f8ccf',
  ok: '#6ee7a8',
  caret: '#e8e8ec',
  icon: 'rgba(255, 255, 255, 0.45)',
};

/**
 * A small terminal that shows a guide's commands being typed, so "run this on your PC" is something
 * you can see, not a paragraph to read. It is an illustration with real content: the commands are
 * the exact ones to run (each has a copy button) and the outputs are what the CLI really prints.
 * It plays once when it appears and then stays on its last frame.
 */
export function TerminalGuide({
  steps,
  path = '~',
  title = 'Terminal',
  style,
}: {
  steps: TerminalStep[];
  path?: string;
  title?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const total = steps.reduce((n, s) => n + s.command.length, 0);
  // Progress: characters typed across all commands, and how many outputs are showing.
  const [typed, setTyped] = useState(0);
  const [shown, setShown] = useState(0);

  // One timer drives it: type the current command, pause, show its output, pause, next command.
  useEffect(() => {
    let before = 0;
    for (let i = 0; i < steps.length; i++) {
      const end = before + steps[i]!.command.length;
      if (typed < end) {
        const t = setTimeout(
          () => setTyped((n) => n + 1),
          i > 0 && typed === before ? AFTER_OUTPUT_MS : TYPE_MS,
        );
        return () => clearTimeout(t);
      }
      if (shown <= i) {
        const t = setTimeout(() => setShown(i + 1), AFTER_COMMAND_MS);
        return () => clearTimeout(t);
      }
      before = end;
    }
    return undefined;
  }, [typed, shown, steps]);

  const done = typed >= total && shown >= steps.length;
  const ends = steps.map((_, i) => steps.slice(0, i + 1).reduce((n, x) => n + x.command.length, 0));
  return (
    <View
      accessibilityLabel={`${title}: ${steps.map((s) => s.command).join(', then ')}`}
      testID="terminal-guide"
      style={[{ borderRadius: radius.lg, backgroundColor: TERM.bg, overflow: 'hidden' }, style]}
    >
      <View
        accessibilityElementsHidden
        style={{
          height: 32,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          backgroundColor: TERM.bar,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: TERM.light }} />
          ))}
        </View>
        <Text
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            textAlign: 'center',
            fontFamily: fonts.regular,
            fontSize: 11,
            color: TERM.dim,
          }}
        >
          {title}
        </Text>
      </View>
      <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 }}>
        {steps.map((step, i) => {
          const end = ends[i]!;
          const start = end - step.command.length;
          const n = Math.max(0, Math.min(step.command.length, typed - start));
          const typing = typed >= start && typed < end;
          const reached = typed >= start;
          return (
            // A line not reached yet keeps its place (the terminal never changes height) but is hidden.
            <View key={i} style={{ opacity: reached ? 1 : 0 }} accessibilityElementsHidden={!reached}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <Text
                  style={{
                    flex: 1,
                    fontFamily: fonts.mono,
                    fontSize: 12.5,
                    lineHeight: 21,
                    color: TERM.text,
                  }}
                >
                  <Text style={{ color: TERM.path }}>{path}</Text>
                  <Text style={{ color: TERM.ok }}> ❯ </Text>
                  {step.command.slice(0, n)}
                  {typing && <Caret still />}
                  {/* The rest of the command reserves its space, so nothing reflows as it is typed. */}
                  <Text style={{ color: 'transparent' }}>{step.command.slice(n)}</Text>
                </Text>
                <CopyCommand command={step.command} />
              </View>
              {step.output && (
                <Fade visible={shown > i}>
                  <Text style={{ fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 21, color: TERM.ok }}>
                    {step.output}
                  </Text>
                </Fade>
              )}
            </View>
          );
        })}
        {/* At rest: a fresh prompt with a blinking caret. */}
        <Fade visible={done}>
          <Text
            accessibilityElementsHidden
            style={{ fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 21, color: TERM.text }}
          >
            <Text style={{ color: TERM.path }}>{path}</Text>
            <Text style={{ color: TERM.ok }}> ❯ </Text>
            <Caret />
          </Text>
        </Fade>
      </View>
    </View>
  );
}

/** A block caret: holds while typing, blinks at rest. Inline in text, so sized like a glyph. */
function Caret({ still }: { still?: boolean }) {
  const o = useSharedValue(1);
  useEffect(() => {
    o.set(still ? 1 : withRepeat(withTiming(0, { duration: 530, easing: ease.move }), -1, true));
  }, [still, o]);
  const blink = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      style={[{ width: 8, height: 14, marginBottom: -2, marginLeft: 1, backgroundColor: TERM.caret }, blink]}
    />
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={copied ? 'Copied' : `Copy: ${command}`}
      haptic={false}
      scale={0.9}
      hitSlop={6}
      onPress={() => {
        tap();
        void Clipboard.setStringAsync(command).then(() => setCopied(true));
      }}
      style={{
        width: 24,
        height: 24,
        marginTop: -1,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {copied ? (
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: '#34c77b',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Check size={10} color="#ffffff" strokeWidth={2.6} />
        </View>
      ) : (
        <Copy size={14} color={TERM.icon} strokeWidth={2} />
      )}
    </Press>
  );
}

/** Milliseconds a guide of these steps takes to play, for anything waiting on it. */
export function guideDuration(steps: TerminalStep[]): number {
  const chars = steps.reduce((n, s) => n + s.command.length, 0);
  return chars * TYPE_MS + steps.length * (AFTER_COMMAND_MS + AFTER_OUTPUT_MS) + dur.enter;
}
