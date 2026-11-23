import {
  clockTime,
  commandError,
  dayLabel,
  daysAgo,
  isQueued,
  STATUS_LABEL,
  type AskedQuestion,
  type ChatItem,
} from '@pocket-agent/core';
import type { CommandDto, CommandStatus } from '@pocket-agent/protocol';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowDown,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  Copy as CopyIcon,
  Laptop,
  MessageCircleQuestion,
  ShieldAlert,
  Smartphone,
  type LucideIcon,
} from 'lucide-react-native';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type ListRenderItemInfo,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeInUp,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Path, Svg } from 'react-native-svg';
import { Markdown } from '@/features/chat/markdown';
import { SentAttachments } from '@/features/chat/sent-attachments';
import { dur, ease, enter, exit, STAGGER } from '@/lib/motion';
import { alpha, fonts, radius, useTheme, type Colors } from '@/lib/theme';
import { CopyButton } from '@/ui/copy-button';
import { Divider, Dot, Press, T, thud } from '@/ui/core';

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>;

/** Space between rows (the web's gap-4). */
const GAP = 16;
const PAD = 16;
const MONO: TextStyle = { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18.5 };

// ── User messages ────────────────────────────────────────────────────────────

const TICK: Record<CommandStatus, { Icon: LucideIcon; color: (c: Colors) => string }> = {
  Pending: { Icon: Clock, color: (c) => c.bubbleMeta },
  Delivered: { Icon: Check, color: (c) => c.bubbleMeta },
  Accepted: { Icon: CheckCheck, color: (c) => c.bubbleMeta },
  Executing: { Icon: CheckCheck, color: (c) => c.primary },
  Completed: { Icon: CheckCheck, color: (c) => c.toolLink },
  Failed: { Icon: CircleAlert, color: (c) => c.destructive },
  Expired: { Icon: Clock, color: (c) => c.destructive },
};

/** Long messages are folded, like a messenger's "Read more". */
const FOLD_CHARS = 700;
const FOLD_LINES = 12;

/** Where a long-pressed bubble is on screen, to place its menu next to it. */
interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MENU_HEIGHT = 48;

/**
 * The menu a long-pressed message opens, like a messenger's: just above the bubble (below it when
 * there is no room), lined up with its right edge. A tap anywhere else closes it.
 */
function BubbleMenu({ anchor, text, onClose }: { anchor: Anchor | null; text: string; onClose: () => void }) {
  const { c, dark } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (!anchor) return null;
  const above = anchor.y - MENU_HEIGHT - 8 > insets.top + 8;
  const top = above ? anchor.y - MENU_HEIGHT - 8 : anchor.y + anchor.height + 8;
  const right = Math.max(12, width - (anchor.x + anchor.width));
  const copy = () => {
    onClose();
    // Android confirms a copy itself (its own "Copied" bubble), so no toast of ours.
    void Clipboard.setStringAsync(text).catch(() => undefined);
  };
  return (
    <Modal
      transparent
      visible
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close menu" onPress={onClose} />
      <Animated.View
        entering={enter.pop}
        accessibilityRole="menu"
        style={{
          position: 'absolute',
          top,
          right,
          minWidth: 148,
          borderRadius: radius.lg,
          backgroundColor: c.popover,
          borderWidth: dark ? 0 : StyleSheet.hairlineWidth,
          borderColor: c.border,
          shadowColor: '#000',
          shadowOpacity: 0.22,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 10,
          overflow: 'hidden',
        }}
      >
        <Press
          accessibilityRole="menuitem"
          testID="copy-message"
          onPress={copy}
          scale={1}
          haptic={false}
          style={{
            height: MENU_HEIGHT,
            paddingHorizontal: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <CopyIcon size={18} color={c.foreground} strokeWidth={2} />
          <T variant="bodyMedium">Copy</T>
        </Press>
      </Animated.View>
    </Modal>
  );
}

function UserMessage({ item }: { item: Of<'user'> }) {
  const { c } = useTheme();
  const bubble = useRef<ComponentRef<typeof View>>(null);
  const [menu, setMenu] = useState<Anchor | null>(null);
  const openMenu = () => {
    bubble.current?.measureInWindow((x, y, width, height) => {
      thud();
      setMenu({ x, y, width, height });
    });
  };
  const cmd = item.command;
  const tick = cmd ? TICK[cmd.status] : null;
  const err = cmd ? commandError(cmd) : null;
  const long = item.text.length > FOLD_CHARS || item.text.split('\n').length > FOLD_LINES;
  const [open, setOpen] = useState(false);
  const status = cmd ? STATUS_LABEL[cmd.status] : null;
  // The tick settles in only when the status changes under you, not for history.
  const [firstStatus] = useState(cmd?.status);
  const Device = cmd ? Smartphone : Laptop;
  return (
    <View
      style={{ alignItems: 'flex-end', gap: 4 }}
      testID={cmd ? 'command-row' : undefined}
      accessibilityLabel={status && !err ? status : undefined}
    >
      {/* As in Claude Code: the time above, the prompt in a quiet box. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Device
          size={12}
          color={c.mutedForeground}
          strokeWidth={2}
          accessibilityLabel={cmd ? 'Sent from Pocket Agent' : 'Typed on the PC'}
        />
        <T variant="caption" tone="muted" style={{ fontSize: 11, fontVariant: ['tabular-nums'] }}>
          {clockTime(item.at)}
        </T>
        {tick && cmd && (
          <Animated.View
            key={cmd.status}
            entering={cmd.status !== firstStatus ? enter.pop : undefined}
            accessibilityLabel={status ?? undefined}
          >
            <tick.Icon size={14} color={tick.color(c)} strokeWidth={2.2} />
          </Animated.View>
        )}
      </View>
      {/* Long-press for the message's menu (Copy). */}
      <Pressable
        ref={bubble}
        onLongPress={openMenu}
        delayLongPress={350}
        accessibilityHint="Long-press for options"
        accessibilityActions={[{ name: 'longpress', label: 'Show options' }]}
        onAccessibilityAction={openMenu}
        style={{
          maxWidth: '88%',
          backgroundColor: c.bubbleOut,
          borderRadius: 16,
          borderTopRightRadius: 6,
          paddingHorizontal: 14,
          paddingVertical: 8,
        }}
      >
        {item.attachments && <SentAttachments files={item.attachments} />}
        <Text
          numberOfLines={long && !open ? FOLD_LINES : undefined}
          style={{
            fontFamily: fonts.regular,
            fontSize: 15.25,
            lineHeight: 22.5,
            color: c.bubbleOutForeground,
          }}
        >
          {item.text}
        </Text>
        {long && (
          <Press
            accessibilityRole="button"
            onPress={() => setOpen(!open)}
            scale={0.98}
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
          >
            <T
              variant="smallMedium"
              style={{
                fontFamily: fonts.semibold,
                fontSize: 13,
                color: c.bubbleOutForeground,
                textDecorationLine: 'underline',
              }}
            >
              {open ? 'Show less' : 'Read more'}
            </T>
          </Press>
        )}
      </Pressable>
      <BubbleMenu anchor={menu} text={item.text} onClose={() => setMenu(null)} />
      {err && (
        <Animated.View entering={enter.fade}>
          <T variant="caption" tone="danger" style={{ fontSize: 11, textAlign: 'right' }}>
            {err}
          </T>
        </Animated.View>
      )}
    </View>
  );
}

// ── Claude's steps ───────────────────────────────────────────────────────────

const DOT = 9;
const DOT_LEFT = 0;
const STEP_INDENT = 22;

/**
 * One step of Claude's side of the conversation, drawn like the editor: a dot on a vertical line
 * that joins consecutive steps. `dotTop` is where the first line of text sits; `joinAbove` and
 * `joinBelow` draw the hairline to the neighbouring steps (through the row gap).
 */
function Step({
  dot,
  pulse,
  dotTop = 7,
  joinAbove,
  joinBelow,
  children,
  testID,
}: {
  dot: string;
  pulse?: boolean;
  dotTop?: number;
  joinAbove: boolean;
  joinBelow: boolean;
  children: ReactNode;
  testID?: string;
}) {
  const { c } = useTheme();
  const centre = dotTop + DOT / 2;
  return (
    <View style={{ paddingLeft: STEP_INDENT }} testID={testID}>
      {joinAbove && (
        <View
          aria-hidden
          style={{
            position: 'absolute',
            left: DOT_LEFT + 4,
            top: 0,
            height: centre,
            width: 1,
            backgroundColor: c.border,
          }}
        />
      )}
      {joinBelow && (
        <View
          aria-hidden
          style={{
            position: 'absolute',
            left: DOT_LEFT + 4,
            top: centre,
            bottom: -GAP,
            width: 1,
            backgroundColor: c.border,
          }}
        />
      )}
      <View
        aria-hidden
        style={{
          position: 'absolute',
          left: DOT_LEFT - 3,
          top: dotTop - 3,
          padding: 3,
          borderRadius: 99,
          backgroundColor: c.background,
        }}
      >
        <Dot color={dot} size={DOT} pulse={pulse} />
      </View>
      {children}
    </View>
  );
}

type Join = { joinAbove: boolean; joinBelow: boolean };

function AssistantMessage({ item, ...join }: { item: Of<'assistant'> } & Join) {
  const { c } = useTheme();
  return (
    <Step dot={alpha(c.mutedForeground, 0.45)} dotTop={16 + 7} {...join}>
      <View style={{ paddingTop: 16 }}>
        <T
          variant="caption"
          tone="muted"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            fontSize: 11,
            lineHeight: 16,
            fontVariant: ['tabular-nums'],
          }}
        >
          {clockTime(item.at)}
        </T>
        <View accessibilityLabel="Claude:">
          <Markdown text={item.text} />
        </View>
        {/* As in the editor: the reply that ends a turn can be copied whole. */}
        {!join.joinBelow && (
          <View style={{ flexDirection: 'row', marginTop: 4, marginLeft: -8 }}>
            <CopyButton value={item.text} label="Copy response" size={40} testID="copy-response" />
          </View>
        )}
      </View>
    </Step>
  );
}

const TOOL_STATE: Record<Of<'tool'>['state'], string> = {
  running: 'running',
  done: 'finished',
  failed: 'failed',
};

const SHELL = new Set(['Bash', 'PowerShell', 'BashOutput']);

function IoLabel({ children }: { children: string }) {
  return (
    <T
      variant="caption"
      tone="muted"
      style={{ width: 28, fontFamily: fonts.semibold, fontSize: 10.5, lineHeight: 18.5 }}
    >
      {children}
    </T>
  );
}

/**
 * A tool call as Claude Code shows it. Shell commands get an IN/OUT block (one line of command,
 * the first lines of output, tap for all); other tools a single line: the name, then the file,
 * pattern or URL it used.
 */
function ToolStep({ item, ...join }: { item: Of<'tool'> } & Join) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const target = item.target || '';
  const output = item.output ?? '';
  const shell = SHELL.has(item.toolName);
  const block = shell ? !!(target || output) : !!output;
  const more = shell && (target.length > 48 || target.includes('\n') || output.split('\n').length > 3);
  const dot = item.state === 'running' ? c.primary : item.state === 'done' ? c.success : c.destructive;
  const outColor = item.state === 'failed' ? c.destructive : c.mutedForeground;
  const outText = (
    <Text selectable style={[MONO, { flex: 1, color: outColor }]} numberOfLines={open ? undefined : 3}>
      {output}
    </Text>
  );
  return (
    <Step dot={dot} pulse={item.state === 'running'} {...join} testID={`tool-${item.state}`}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <T variant="smallMedium" style={{ fontFamily: fonts.semibold, lineHeight: 22 }}>
          {item.toolName}
        </T>
        <View accessibilityLabel={TOOL_STATE[item.state]} />
        {!shell && target && (
          <Text
            numberOfLines={1}
            style={{ flex: 1, fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 22, color: c.toolLink }}
          >
            {target}
          </Text>
        )}
      </View>
      {block && (
        <View style={{ marginTop: 4 }}>
          <Press
            accessibilityRole="button"
            accessibilityState={more ? { expanded: open } : undefined}
            accessibilityLabel={more ? (open ? 'Show less' : 'Show more') : undefined}
            disabled={!more}
            onPress={() => setOpen(!open)}
            scale={0.99}
            dim={false}
            style={{ borderRadius: radius.sm, backgroundColor: c.card, overflow: 'hidden', opacity: 1 }}
          >
            {shell && target && (
              <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 10, paddingVertical: 6 }}>
                <IoLabel>IN</IoLabel>
                <Text
                  selectable
                  numberOfLines={open ? undefined : 1}
                  style={[MONO, { flex: 1, color: c.foreground }]}
                >
                  {target}
                </Text>
              </View>
            )}
            {output && (
              <View
                style={{
                  flexDirection: 'row',
                  gap: 12,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderTopWidth: shell && target ? StyleSheet.hairlineWidth : 0,
                  borderTopColor: c.border,
                }}
              >
                <IoLabel>OUT</IoLabel>
                {open ? (
                  <ScrollView nestedScrollEnabled style={{ flex: 1, maxHeight: 320 }}>
                    {outText}
                  </ScrollView>
                ) : (
                  <View style={{ flex: 1 }}>
                    {outText}
                    {output.split('\n').length > 3 && (
                      // The fold fades out at its foot (tap shows all).
                      <LinearGradient
                        pointerEvents="none"
                        colors={[alpha(c.card, 0), c.card]}
                        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 26 }}
                      />
                    )}
                  </View>
                )}
              </View>
            )}
          </Press>
        </View>
      )}
    </Step>
  );
}

const QUESTION_STATE = {
  running: { text: 'Waiting for your answer on the PC', tone: 'primary' },
  done: { text: 'Answered', tone: 'success' },
  failed: { text: 'Declined', tone: 'muted' },
} as const;

/** Claude asking the user something (AskUserQuestion), shown like the question card in VS Code. */
function QuestionCard({ item, ...join }: { item: Of<'question'> } & Join) {
  const { c } = useTheme();
  const st = QUESTION_STATE[item.state];
  return (
    <Step dot={c.primary} dotTop={14} {...join} testID="question-card">
      <View
        style={{
          borderRadius: radius.lg,
          backgroundColor: c.card,
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MessageCircleQuestion size={16} color={c.primary} strokeWidth={2.2} />
          <T variant="smallMedium" style={{ fontFamily: fonts.semibold, fontSize: 13 }}>
            {item.questions.length > 1 ? `${item.questions.length} questions` : 'Question'}
          </T>
          <T
            variant="captionMedium"
            tone={st.tone}
            style={{ marginLeft: 'auto', textAlign: 'right', flexShrink: 1 }}
          >
            {st.text}
          </T>
        </View>
        {item.questions.length === 0 && (
          <T variant="small" tone="muted" style={{ marginTop: 8 }}>
            Claude asked you a question. Update Pocket Agent on the PC to see it here.
          </T>
        )}
        <AskedQuestions questions={item.questions} answers={item.answers} />
      </View>
    </Step>
  );
}

/** Claude's questions with their options (and the chosen answers, once known). */
export function AskedQuestions({
  questions,
  answers = {},
}: {
  questions: AskedQuestion[];
  answers?: Record<string, string>;
}) {
  const { c } = useTheme();
  return (
    <>
      {questions.map((q, qi) => {
        const answer = answers[q.question];
        const chosen = new Set(answer ? answer.split(',').map((a) => a.trim()) : []);
        const other = !!answer && !q.options.some((o) => chosen.has(o.label));
        return (
          <View key={qi} style={{ marginTop: 12 }}>
            {q.header && (
              <View
                style={{
                  alignSelf: 'flex-start',
                  borderRadius: radius.full,
                  backgroundColor: c.accent,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  marginBottom: 6,
                }}
              >
                <T variant="captionMedium" style={{ fontSize: 11, color: c.accentForeground }}>
                  {q.header}
                </T>
              </View>
            )}
            <T variant="smallMedium">{q.question}</T>
            {q.multiSelect && (
              <T variant="caption" tone="muted" style={{ marginTop: 2 }}>
                Pick any
              </T>
            )}
            <View style={{ marginTop: 4 }}>
              {q.options.map((o, oi) => {
                const on = chosen.has(o.label);
                return (
                  <View key={o.label}>
                    {oi > 0 && <Divider />}
                    {/* One card: options are rows split by dividers, the chosen one in the accent colour. */}
                    <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 10 }}>
                      <View
                        aria-hidden
                        style={{
                          marginTop: 2,
                          width: 16,
                          height: 16,
                          borderRadius: q.multiSelect ? 4 : 8,
                          borderWidth: 1,
                          borderColor: on ? c.primary : alpha(c.mutedForeground, 0.4),
                          backgroundColor: on ? c.primary : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {on && <Check size={11} color={c.primaryForeground} strokeWidth={3} />}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T
                          variant="smallMedium"
                          style={{ fontSize: 13, color: on ? c.primary : c.foreground }}
                          accessibilityLabel={on ? `${o.label} (chosen)` : undefined}
                        >
                          {o.label}
                        </T>
                        {o.description && (
                          <T
                            variant="caption"
                            style={{ marginTop: 2, color: on ? c.primary : c.mutedForeground }}
                          >
                            {o.description}
                          </T>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
            {other && (
              <T variant="caption" style={{ marginTop: 8 }}>
                <T variant="caption" tone="muted">
                  Your answer:{' '}
                </T>
                {answer}
              </T>
            )}
          </View>
        );
      })}
    </>
  );
}

function PermissionRow({ item, ...join }: { item: Of<'permission'> } & Join) {
  const { c } = useTheme();
  return (
    <Step dot={c.warning} dotTop={14} {...join}>
      <View
        style={{
          borderRadius: radius.lg,
          backgroundColor: c.card,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ShieldAlert size={16} color={c.warning} strokeWidth={2.2} />
          <T variant="smallMedium" style={{ fontSize: 13, flex: 1 }}>
            Permission requested: {item.toolName}
          </T>
        </View>
        {item.target && (
          <Text
            selectable
            style={[
              MONO,
              {
                marginTop: 6,
                borderRadius: radius.sm,
                backgroundColor: alpha(c.muted, 0.7),
                paddingHorizontal: 8,
                paddingVertical: 4,
                color: c.foreground,
              },
            ]}
          >
            {item.target}
          </Text>
        )}
        <T variant="caption" tone="muted" style={{ marginTop: 6 }}>
          {item.outcome ?? 'Waiting for a decision…'}
        </T>
      </View>
    </Step>
  );
}

function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'danger' }) {
  const { c } = useTheme();
  const danger = tone === 'danger';
  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{
          maxWidth: '90%',
          borderRadius: radius.full,
          paddingHorizontal: 12,
          paddingVertical: 4,
          backgroundColor: danger ? alpha(c.destructive, 0.1) : c.muted,
        }}
      >
        <T variant="caption" center style={{ color: danger ? c.destructive : c.mutedForeground }}>
          {children}
        </T>
      </View>
    </View>
  );
}

function controlText(c: CommandDto): string {
  const what = c.commandType === 'interrupt' ? 'You interrupted Claude' : 'You ended the session';
  return `${what} · ${commandError(c) ?? STATUS_LABEL[c.status]}`;
}

/** The wavy hairline of a day separator (the web's .wavy-rule). */
function WavyRule() {
  const { c } = useTheme();
  const waves = 80;
  let d = 'M0 3';
  for (let i = 0; i < waves; i++) d += ` Q${i * 12 + 3} 0 ${i * 12 + 6} 3 T${i * 12 + 12} 3`;
  return (
    <View aria-hidden style={{ flex: 1, height: 6, overflow: 'hidden' }}>
      <Svg width={waves * 12} height={6} viewBox={`0 0 ${waves * 12} 6`}>
        <Path d={d} fill="none" stroke={c.mutedForeground} strokeOpacity={0.35} strokeWidth={1.2} />
      </Svg>
    </View>
  );
}

function DaySeparator({ at }: { at: string }) {
  return (
    <View
      accessibilityLabel={dayLabel(at)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}
    >
      <WavyRule />
      <T variant="captionMedium" tone="muted">
        {dayLabel(at)}
      </T>
      <WavyRule />
    </View>
  );
}

// ── Typing indicator ─────────────────────────────────────────────────────────

const VERBS = [
  'Churning',
  'Perusing',
  'Forming',
  'Herding',
  'Cooking',
  'Pondering',
  'Brewing',
  'Mulling',
  'Crafting',
  'Tinkering',
  'Percolating',
  'Conjuring',
  'Simmering',
  'Whirring',
  'Ruminating',
  'Noodling',
  'Musing',
  'Computing',
  'Spinning',
  'Wrangling',
  'Marinating',
  'Synthesizing',
];

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** One step of typing `to` over `from`: `i` letters are already the new word. */
export function typeOver(from: string, to: string, i: number): string {
  // First the new letters replace the old ones from the left…
  if (i <= to.length) return to.slice(0, i) + from.slice(i);
  // …then what is left of a longer old word is deleted from the end.
  return to + from.slice(to.length, Math.max(to.length, from.length - (i - to.length)));
}

const TYPE_STEP_MS = 55;

const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽'];
const SPIN = [...FRAMES, ...FRAMES.slice(1, -1).reverse()]; // ping-pong, like a breathing star

/** Claude-style breathing star. Holds still for people who ask for reduced motion. */
function ClaudeSpinner() {
  const { c } = useTheme();
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(id);
  }, [reduce]);
  return (
    <Text
      aria-hidden
      style={{
        width: 18,
        textAlign: 'center',
        fontFamily: fonts.mono,
        fontSize: 16,
        lineHeight: 20,
        color: c.primary,
      }}
    >
      {SPIN[tick % SPIN.length]}
    </Text>
  );
}

/** `hex` moved `t` of the way to white. */
function lighten(hex: string, t: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * t);
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

const SHIMMER_MS = 2200;
const SHIMMER_WIDTH = 2.5;

function ShimmerLetter({
  char,
  index,
  count,
  progress,
  base,
  light,
}: {
  char: string;
  index: number;
  count: number;
  progress: SharedValue<number>;
  base: string;
  light: string;
}) {
  const style = useAnimatedStyle(() => {
    // The highlight travels from past the right edge to past the left, like the web's gradient.
    const pos = (1 - progress.get()) * (count + 2 * SHIMMER_WIDTH) - SHIMMER_WIDTH;
    const t = Math.max(0, 1 - Math.abs(index - pos) / SHIMMER_WIDTH);
    return { color: interpolateColor(t, [0, 1], [base, light]) };
  });
  return (
    <Animated.Text style={[{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 }, style]}>
      {char}
    </Animated.Text>
  );
}

/** A word with a soft highlight sweeping through it (the web's .shimmer-text). */
/**
 * A terminal's block cursor: a solid rounded rectangle in the accent. Solid while typing; resting,
 * it blinks softly (still when motion is reduced).
 */
function BlockCursor({ blink }: { blink: boolean }) {
  const { c } = useTheme();
  const reduce = useReducedMotion();
  const on = useSharedValue(1);
  useEffect(() => {
    if (!blink || reduce) {
      cancelAnimation(on);
      on.set(1);
      return;
    }
    on.set(
      withRepeat(
        withSequence(
          withDelay(450, withTiming(0.15, { duration: 160, easing: Easing.out(Easing.quad) })),
          withDelay(300, withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) })),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(on);
  }, [blink, reduce, on]);
  const style = useAnimatedStyle(() => ({ opacity: on.value }));
  return (
    <Animated.View
      style={[
        { width: 7.5, height: 15, borderRadius: 1.5, marginHorizontal: 1, backgroundColor: c.primary },
        style,
      ]}
    />
  );
}

/** Shimmering letters, with the block cursor at `cursor` (a letter index; the end when null). */
function ShimmerText({ text, cursor }: { text: string; cursor: number | null }) {
  const { c } = useTheme();
  const reduce = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    progress.set(withRepeat(withTiming(1, { duration: SHIMMER_MS, easing: Easing.linear }), -1, false));
  }, [reduce, progress]);
  const light = lighten(c.primary, 0.65);
  const letters = [...text];
  const at = cursor === null ? letters.length : Math.min(cursor, letters.length);
  const letter = (ch: string, i: number) => (
    <ShimmerLetter
      key={i}
      char={ch}
      index={i}
      count={letters.length}
      progress={progress}
      base={c.primary}
      light={light}
    />
  );
  return (
    <View aria-hidden style={{ flexDirection: 'row', alignItems: 'center' }}>
      {letters.slice(0, at).map((ch, i) => letter(ch, i))}
      <BlockCursor blink={cursor === null} />
      {letters.slice(at).map((ch, i) => letter(ch, at + i))}
    </View>
  );
}

/**
 * "✻ Churning… (12s)" — a breathing star, a rotating verb and shimmering text while Claude works.
 * All the ticking lives in this small component, so the conversation itself never re-renders for it.
 */
export function TypingIndicator({ kind, since }: { kind: 'working' | 'starting'; since: string | null }) {
  const reduce = useReducedMotion();
  const [start] = useState(() => (since ? Math.min(Date.parse(since), Date.now()) : Date.now()));
  const [now, setNow] = useState(() => Date.now());
  // What is on screen: mid-change it is part new word, part old.
  const [shown, setShown] = useState(() => VERBS[Math.floor(Math.random() * VERBS.length)]!);
  /** The verb being shown or typed towards. */
  const current = useRef(shown);
  /** Where the cursor is while a word is being typed; null when it rests at the end. */
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    let typing: ReturnType<typeof setInterval> | undefined;
    // Every few seconds the next verb is typed over the current one, like a typewriter.
    const words = setInterval(() => {
      const from = current.current;
      let to = from;
      while (to === from) to = VERBS[Math.floor(Math.random() * VERBS.length)]!;
      current.current = to;
      if (reduce) return setShown(to);
      let i = 0;
      const steps = Math.max(to.length, from.length);
      clearInterval(typing);
      typing = setInterval(() => {
        i += 1;
        const next = typeOver(from, to, i);
        setShown(next);
        // Over the old letters it stands where it types; deleting the rest, at the end.
        setCursor(i >= steps ? null : i <= to.length ? i : next.length);
        if (i >= steps) clearInterval(typing);
      }, TYPE_STEP_MS);
    }, 3500);
    return () => {
      clearInterval(clock);
      clearInterval(words);
      clearInterval(typing);
    };
  }, [reduce]);

  const word = kind === 'starting' ? 'Starting' : shown;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Claude is working"
      testID="typing-indicator"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}
    >
      <ClaudeSpinner />
      <ShimmerText text={word} cursor={kind === 'starting' ? null : cursor} />
      <T variant="caption" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
        ({elapsed(now - start)})
      </T>
    </View>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────

type Row =
  | { type: 'day'; key: string; at: string }
  | { type: 'item'; key: string; item: ChatItem; joinAbove: boolean; joinBelow: boolean }
  | { type: 'typing'; key: 'typing'; kind: 'working' | 'starting'; since: string | null };

const isStep = (i: ChatItem) =>
  i.kind === 'assistant' ||
  i.kind === 'tool' ||
  i.kind === 'thought' ||
  i.kind === 'question' ||
  i.kind === 'permission';

/**
 * The conversation as list rows: a separator whenever the day changes, consecutive steps joined by
 * the hairline, the typing indicator after the last thing said, and queued messages under it all.
 */
function buildRows(items: ChatItem[], typing: 'working' | 'starting' | null): Row[] {
  const queued = items.filter((i): i is Of<'user'> => isQueued(i));
  const said = queued.length ? items.filter((i) => !isQueued(i)) : items;
  const rows: Row[] = [];
  let lastDay: number | null = null;
  for (let i = 0; i < said.length; i++) {
    const item = said[i]!;
    const day = daysAgo(item.at);
    const newDay = day !== lastDay;
    if (newDay) {
      rows.push({ type: 'day', key: `day-${item.key}`, at: item.at });
      lastDay = day;
    }
    const next = said[i + 1];
    const prev = rows[rows.length - 1];
    rows.push({
      type: 'item',
      key: item.key,
      item,
      joinAbove: isStep(item) && !newDay && !!prev && prev.type === 'item' && isStep(prev.item),
      joinBelow: isStep(item) && !!next && isStep(next) && daysAgo(next.at) === day,
    });
  }
  if (typing) {
    rows.push({
      type: 'typing',
      key: 'typing',
      kind: typing,
      since: [...said].reverse().find((i) => i.kind === 'user')?.at ?? null,
    });
  }
  // Sent but not picked up yet: these stay under everything until Claude takes them.
  for (const item of queued)
    rows.push({ type: 'item', key: item.key, item, joinAbove: false, joinBelow: false });
  return rows;
}

function RowContent({ row }: { row: Row }) {
  const { c } = useTheme();
  switch (row.type) {
    case 'day':
      return <DaySeparator at={row.at} />;
    case 'typing':
      return <TypingIndicator kind={row.kind} since={row.since} />;
  }
  const { item, joinAbove, joinBelow } = row;
  const join = { joinAbove, joinBelow };
  switch (item.kind) {
    case 'user':
      return <UserMessage item={item} />;
    case 'assistant':
      return <AssistantMessage item={item} {...join} />;
    case 'tool':
      return <ToolStep item={item} {...join} />;
    case 'thought':
      return (
        <Step dot={alpha(c.mutedForeground, 0.3)} {...join} testID="thought">
          <T variant="small" tone="muted" style={{ fontSize: 13.5, lineHeight: 22 }}>
            {item.text}
          </T>
        </Step>
      );
    case 'question':
      return <QuestionCard item={item} {...join} />;
    case 'permission':
      return <PermissionRow item={item} {...join} />;
    case 'control':
      return <Pill>{controlText(item.command)}</Pill>;
    case 'notice':
      return <Pill tone={item.tone}>{item.text}</Pill>;
  }
}

/** A row that arrives while the chat is open rises into place (the list is inverted: up is -y). */
const arrive = (index: number) =>
  FadeInUp.duration(dur.enter + 40)
    .easing(ease.out)
    .delay(Math.min(index, 8) * STAGGER)
    .withInitialValues({ opacity: 0, transform: [{ translateY: -12 }] });

/** One row of the list; a row that arrived after the first render rises into place. */
const ListRow = memo(function ListRow({ row, fresh }: { row: Row; fresh: number | undefined }) {
  return (
    <Animated.View
      entering={fresh === undefined ? undefined : arrive(fresh)}
      style={{ paddingHorizontal: PAD, paddingBottom: row.type === 'item' && isQueued(row.item) ? 12 : GAP }}
    >
      <RowContent row={row} />
    </Animated.View>
  );
});

const rowKey = (row: Row) => row.key;
const NEAR_BOTTOM = 80;

/**
 * The scrolling conversation, as a messenger draws it: an inverted list, so it opens on the newest
 * message and rows lay out in place (no measuring pass that shuffles them). At the bottom, new
 * messages come into view; scrolled up, it stays put and offers a jump back.
 */
export function ChatMessages({
  items,
  typing,
  header,
  footer,
  bottomInset = 0,
}: {
  items: ChatItem[];
  typing: 'working' | 'starting' | null;
  header?: ReactNode;
  footer?: ReactNode;
  /** Room left under the last message (what floats over the list: the message box). */
  bottomInset?: number;
}) {
  const { c, dark } = useTheme();
  // Newest first: the inverted list draws index 0 at the bottom.
  const rows = useMemo(() => buildRows(items, typing).reverse(), [items, typing]);
  const list = useRef<FlatList<Row>>(null);
  const atBottom = useRef(true);
  const [away, setAway] = useState(false);

  // Only messages that arrive after the first render animate in; the history is just there.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 400);
    return () => clearTimeout(t);
  }, []);
  const [seen, setSeen] = useState(() => new Set(rows.map(rowKey)));
  const [fresh, setFresh] = useState<ReadonlyMap<string, number>>(() => new Map());
  const unseen = rows.filter((r) => !seen.has(r.key));
  if (unseen.length) {
    const nextSeen = new Set(seen);
    const nextFresh = new Map(fresh);
    // Oldest of the new ones first, so a group arrives in reading order.
    [...unseen].reverse().forEach((r, i) => {
      nextSeen.add(r.key);
      if (settled) nextFresh.set(r.key, i);
    });
    setSeen(nextSeen);
    setFresh(nextFresh);
  }
  useEffect(() => {
    if (!fresh.size) return;
    const t = setTimeout(() => setFresh(new Map()), 1500);
    return () => clearTimeout(t);
  }, [fresh]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Inverted: offset 0 is the newest message.
    const near = e.nativeEvent.contentOffset.y < NEAR_BOTTOM;
    if (near !== atBottom.current) {
      atBottom.current = near;
      setAway(!near);
    }
  }, []);

  const toBottom = () => list.current?.scrollToOffset({ offset: 0, animated: true });

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Row>) => <ListRow row={item} fresh={fresh.get(item.key)} />,
    [fresh],
  );

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <FlatList
        ref={list}
        inverted
        testID="timeline"
        accessibilityLabel="Conversation"
        data={rows}
        extraData={fresh}
        renderItem={renderItem}
        keyExtractor={rowKey}
        // Scrolled up, new messages don't move what you are reading; at the bottom they come in.
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: NEAR_BOTTOM }}
        initialNumToRender={14}
        maxToRenderPerBatch={10}
        windowSize={11}
        onScroll={onScroll}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        // Inverted, the header sits under the newest message and the footer above the oldest.
        ListHeaderComponent={
          <View style={{ paddingBottom: bottomInset }}>
            {footer ? <View style={{ paddingHorizontal: PAD, paddingBottom: GAP }}>{footer}</View> : null}
          </View>
        }
        ListFooterComponent={
          <View style={{ paddingHorizontal: PAD, paddingTop: PAD, paddingBottom: header ? GAP : 0 }}>
            {header}
          </View>
        }
        ListEmptyComponent={
          <T variant="small" tone="muted" center style={{ paddingVertical: 40, transform: [{ scaleY: -1 }] }}>
            No messages yet.
          </T>
        }
      />
      {away && (
        <Animated.View
          entering={enter.pop}
          exiting={exit.fade}
          style={{ position: 'absolute', right: PAD, bottom: bottomInset + 12 }}
        >
          <Press
            accessibilityRole="button"
            accessibilityLabel="Scroll to latest"
            onPress={toBottom}
            scale={0.9}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: c.popover,
              borderWidth: dark ? 0 : StyleSheet.hairlineWidth,
              borderColor: c.border,
              shadowColor: '#000',
              shadowOpacity: 0.16,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 6,
            }}
          >
            <ArrowDown size={18} color={c.mutedForeground} strokeWidth={2.2} />
          </Press>
        </Animated.View>
      )}
    </View>
  );
}
