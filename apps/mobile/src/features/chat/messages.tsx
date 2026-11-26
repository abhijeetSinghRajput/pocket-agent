import {
  clockTime,
  commandError,
  controlText,
  dayLabel,
  daysAgo,
  isQueued,
  readAnswer,
  SHELL_TOOLS,
  TOOL_STATE,
  STATUS_LABEL,
  summaryParts,
  type AskedQuestion,
  type ChatItem,
} from '@pocket-agent/core';
import type { CommandStatus } from '@pocket-agent/protocol';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowDown,
  Check,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy as CopyIcon,
  Laptop,
  MessageCircleQuestion,
  Pencil,
  ShieldAlert,
  Smartphone,
  TextSelect,
  type LucideIcon,
} from 'lucide-react-native';
import {
  createContext,
  memo,
  useCallback,
  useContext,
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
  Dimensions,
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
import { MatchAnchor, SearchQuery, useMark } from '@/features/chat/search-mark';
import { Markdown } from '@/features/chat/markdown';
import { SelectTextSheet } from '@/features/chat/select-text-sheet';
import { SentAttachments } from '@/features/chat/sent-attachments';
import { dur, ease, enter, exit, STAGGER } from '@/lib/motion';
import { alpha, fonts, radius, useTheme, type Colors } from '@/lib/theme';
import { CopyIconButton } from '@/ui/copy';
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

/** A message kept on this phone until it can go. */
const WAITING_TICK = { Icon: Clock, color: (c: Colors) => c.mutedForeground };

/**
 * Why kept messages haven't gone yet, and that they will by themselves. Given by the chat around
 * the list.
 */
export const WaitingReason = createContext('Sends by itself when it can');

function WaitingNote() {
  const reason = useContext(WaitingReason);
  return (
    <Animated.View entering={enter.fade} testID="waiting-note">
      <T variant="caption" tone="muted" style={{ fontSize: 11, textAlign: 'right' }}>
        {reason}
      </T>
    </Animated.View>
  );
}

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
function BubbleMenu({
  anchor,
  text,
  onClose,
  onSelect,
  onEdit,
}: {
  anchor: Anchor | null;
  text: string;
  onClose: () => void;
  onSelect: () => void;
  /** Only for a message still waiting for Claude (or not sent): edit it in the message box. */
  onEdit?: () => void;
}) {
  const { c, dark } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (!anchor) return null;
  const menuHeight = MENU_HEIGHT * (onEdit ? 3 : 2);
  // Above the press when there is room; a tall message that fills the screen gets it on top of
  // its upper part instead, so the menu is always in view.
  const above = anchor.y - menuHeight - 8 > insets.top + 8;
  const below =
    anchor.y + anchor.height + 8 + menuHeight < Dimensions.get('window').height - insets.bottom - 8;
  const top = above
    ? anchor.y - menuHeight - 8
    : below
      ? anchor.y + anchor.height + 8
      : Math.max(insets.top + 8, anchor.y + 8);
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
        {onEdit && (
          <>
            <Press
              accessibilityRole="menuitem"
              testID="edit-message"
              onPress={() => {
                onClose();
                onEdit();
              }}
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
              <Pencil size={18} color={c.foreground} strokeWidth={2} />
              <T variant="bodyMedium">Edit</T>
            </Press>
            <Divider />
          </>
        )}
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
        <Divider />
        <Press
          accessibilityRole="menuitem"
          testID="select-message-text"
          onPress={() => {
            onClose();
            onSelect();
          }}
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
          <TextSelect size={18} color={c.foreground} strokeWidth={2} />
          <T variant="bodyMedium">Select text</T>
        </Press>
      </Animated.View>
    </Modal>
  );
}

/**
 * Sends again a message that could not be sent (by the message's item key). Given by the chat
 * around the list.
 */
export const RetryContext = createContext<(key: string) => void>(() => undefined);

/**
 * Edits a message Claude hasn't started on: it is taken back and its text goes into the message
 * box. Given by the chat around the list (none: no Edit).
 */
export const EditContext = createContext<((item: Extract<ChatItem, { kind: 'user' }>) => void) | null>(null);

function UserMessage({ item }: { item: Of<'user'> }) {
  const { c } = useTheme();
  const mark = useMark();
  // A long message the search found something in is shown whole.
  const query = useContext(SearchQuery).trim().toLowerCase();
  const found = query.length >= 2 && item.text.toLowerCase().includes(query);
  const bubble = useRef<ComponentRef<typeof View>>(null);
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [selecting, setSelecting] = useState(false);
  const openMenu = () => {
    bubble.current?.measureInWindow((x, y, width, height) => {
      thud();
      setMenu({ x, y, width, height });
    });
  };
  const cmd = item.command;
  const retry = useContext(RetryContext);
  const editMessage = useContext(EditContext);
  // Waiting for Claude (or not sent at all): it can still be edited. On its way: not yet.
  const editable = !!editMessage && isQueued(item) && (!!cmd || (!!item.local && item.local !== 'sending'));
  // Not confirmed yet: a clock, like a message still on its way; not sent: a red mark.
  const tick = cmd
    ? TICK[cmd.status]
    : item.local
      ? item.local === 'waiting'
        ? WAITING_TICK
        : TICK[item.local === 'failed' ? 'Failed' : 'Pending']
      : null;
  const err = cmd ? commandError(cmd) : null;
  const long = item.text.length > FOLD_CHARS || item.text.split('\n').length > FOLD_LINES;
  const [open, setOpen] = useState(false);
  const status = cmd ? STATUS_LABEL[cmd.status] : null;
  // The tick settles in only when the status changes under you, not for history.
  const [firstStatus] = useState(cmd?.status);
  const Device = cmd || item.local ? Smartphone : Laptop;
  return (
    <View
      style={{ alignItems: 'flex-end', gap: 4 }}
      testID={cmd ? 'command-row' : undefined}
      accessibilityLabel={status && !err ? status : undefined}
    >
      {/* Long-press for the message's menu (Copy, Select text). */}
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
          borderBottomRightRadius: 6,
          paddingHorizontal: 14,
          paddingVertical: 8,
        }}
      >
        {item.attachments && <SentAttachments files={item.attachments} />}
        <Text
          numberOfLines={long && !open && !found ? FOLD_LINES : undefined}
          style={{
            fontFamily: fonts.regular,
            fontSize: 15.25,
            lineHeight: 22.5,
            color: c.bubbleOutForeground,
          }}
        >
          {mark(item.text)}
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
      {/* Under the message, as in a messenger: where it came from, the time, its tick. */}
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
        {tick && (
          <Animated.View
            key={cmd?.status ?? item.local}
            entering={
              cmd && cmd.status !== firstStatus ? enter.pop : item.local === 'failed' ? enter.pop : undefined
            }
            accessibilityLabel={
              status ??
              (item.local === 'failed' ? 'Not sent' : item.local === 'waiting' ? 'Waiting' : 'Sending')
            }
          >
            <tick.Icon size={14} color={tick.color(c)} strokeWidth={2.2} />
          </Animated.View>
        )}
      </View>
      <BubbleMenu
        anchor={menu}
        text={item.text}
        onClose={() => setMenu(null)}
        onSelect={() => setSelecting(true)}
        {...(editable ? { onEdit: () => editMessage(item) } : {})}
      />
      <SelectTextSheet text={item.text} open={selecting} onClose={() => setSelecting(false)} />
      {err && (
        <Animated.View entering={enter.fade}>
          <T variant="caption" tone="danger" style={{ fontSize: 11, textAlign: 'right' }}>
            {err}
          </T>
        </Animated.View>
      )}
      {item.local === 'waiting' && <WaitingNote />}
      {item.local === 'failed' && (
        <Animated.View entering={enter.fade}>
          <Press
            accessibilityRole="button"
            accessibilityLabel="Not sent. Send again"
            onPress={() => retry(item.key)}
            scale={0.96}
            hitSlop={8}
            testID="retry-send"
          >
            <T variant="captionMedium" tone="danger" style={{ fontSize: 12, textAlign: 'right' }}>
              Not sent · Tap to retry
            </T>
          </Press>
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
    <Step dot={alpha(c.mutedForeground, 0.45)} dotTop={7} {...join}>
      <View>
        {/* No long-press on a reply: a press held on a table must stay free to scroll it. Copying
            is the button under the reply; your own messages keep their long-press menu. */}
        <View accessibilityLabel="Claude:">
          <Markdown text={item.text} />
        </View>
        {/* Under the reply: Copy (on the reply that ends a turn, as in the editor) and the time. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            marginTop: join.joinBelow ? 2 : 4,
            marginLeft: join.joinBelow ? 0 : -8,
          }}
        >
          {!join.joinBelow && (
            <CopyIconButton value={item.text} label="Copy response" size={40} testID="copy-response" />
          )}
          <T
            variant="caption"
            tone="muted"
            style={{ fontSize: 11, lineHeight: 16, fontVariant: ['tabular-nums'] }}
          >
            {clockTime(item.at)}
          </T>
        </View>
      </View>
    </Step>
  );
}

const ioRow = { flexDirection: 'row', gap: 12, paddingHorizontal: 10, paddingVertical: 6 } as const;

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
  const mark = useMark();
  const target = item.target || '';
  const output = item.output ?? '';
  const shell = SHELL_TOOLS.has(item.toolName);
  const block = shell ? !!(target || output) : !!output;
  // Output can be tens of KB (a build log, a file read): folded, only its first lines are laid out.
  const lines = output.split('\n', 4);
  const long = lines.length > 3;
  const preview = lines.slice(0, 3).join('\n').slice(0, 600);
  const more = shell && (target.length > 48 || target.includes('\n') || long);
  const dot = item.state === 'running' ? c.primary : item.state === 'done' ? c.success : c.destructive;
  const outColor = item.state === 'failed' ? c.destructive : c.mutedForeground;
  const outText = (
    <Text selectable style={[MONO, { flex: 1, color: outColor }]} numberOfLines={open ? undefined : 3}>
      {open ? output : preview}
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
            {mark(target)}
          </Text>
        )}
      </View>
      {block && (
        // The open output scrolls on its own, so it sits outside the tap area: on Android a
        // pressable around a ScrollView takes the touch and the output never scrolls.
        <View style={{ marginTop: 4, borderRadius: radius.sm, backgroundColor: c.card, overflow: 'hidden' }}>
          <Press
            accessibilityRole="button"
            accessibilityState={more ? { expanded: open } : undefined}
            accessibilityLabel={more ? (open ? 'Show less' : 'Show more') : undefined}
            disabled={!more}
            onPress={() => setOpen(!open)}
            scale={0.99}
            dim={false}
            style={{ opacity: 1 }}
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
            {output && !open && (
              <View
                style={[
                  ioRow,
                  {
                    borderTopWidth: shell && target ? StyleSheet.hairlineWidth : 0,
                    borderTopColor: c.border,
                  },
                ]}
              >
                <IoLabel>OUT</IoLabel>
                <View style={{ flex: 1 }}>
                  {outText}
                  {long && (
                    // The fold fades out at its foot (tap shows all).
                    <LinearGradient
                      pointerEvents="none"
                      colors={[alpha(c.card, 0), c.card]}
                      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 26 }}
                    />
                  )}
                </View>
              </View>
            )}
          </Press>
          {output && open && (
            <Animated.View
              entering={enter.fade}
              style={[
                ioRow,
                { borderTopWidth: shell && target ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border },
              ]}
            >
              <IoLabel>OUT</IoLabel>
              <ScrollView nestedScrollEnabled style={{ flex: 1, maxHeight: 320 }}>
                {outText}
              </ScrollView>
            </Animated.View>
          )}
          {output && open && (
            <Press
              accessibilityRole="button"
              accessibilityState={{ expanded: true }}
              onPress={() => setOpen(false)}
              scale={0.99}
              dim={false}
              style={{
                alignItems: 'center',
                paddingVertical: 6,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: c.border,
              }}
            >
              <T variant="caption" tone="muted">
                Show less
              </T>
            </Press>
          )}
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
        const { chosen, own } = readAnswer(q, answer);
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
            {own && (
              <T variant="caption" style={{ marginTop: 8 }}>
                <T variant="caption" tone="muted">
                  Your answer:{' '}
                </T>
                {own}
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
          {item.outcome ?? (item.onPc ? 'Waiting for your answer on the PC' : 'Waiting for a decision…')}
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
/**
 * What the indicator under the conversation stands for: Claude working, starting, or a message
 * just sent from here that Claude takes at once ("sending": shown under that message).
 */
export type TypingKind = 'working' | 'starting' | 'sending';

export function TypingIndicator({ kind, since }: { kind: TypingKind; since: string | null }) {
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
  | { type: 'typing'; key: 'typing'; kind: TypingKind; since: string | null };

const isStep = (i: ChatItem) =>
  i.kind === 'assistant' ||
  i.kind === 'tool' ||
  i.kind === 'thought' ||
  i.kind === 'question' ||
  i.kind === 'permission';

/**
 * The conversation as list rows: a separator whenever the day changes, consecutive steps joined by
 * the hairline, the typing indicator after the last thing said, and queued messages under it all
 * (Claude is still on an earlier one). A message just sent that Claude takes at once ("sending")
 * comes first, with the indicator under it, timed from it.
 */
function buildRows(items: ChatItem[], typing: TypingKind | null): Row[] {
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
  const typingRow = (since: string | null): Row[] =>
    typing ? [{ type: 'typing', key: 'typing', kind: typing, since }] : [];
  // Sent but not picked up yet: these stay under everything until Claude takes them.
  const waiting = queued.map((item): Row => ({
    type: 'item',
    key: item.key,
    item,
    joinAbove: false,
    joinBelow: false,
  }));
  if (typing === 'sending') {
    rows.push(...waiting, ...typingRow(queued.at(-1)?.at ?? null));
  } else {
    rows.push(...typingRow([...said].reverse().find((i) => i.kind === 'user')?.at ?? null), ...waiting);
  }
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
            <Mark text={item.text} />
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
    case 'summary':
      return <TurnSummary item={item} />;
  }
}

/** Where a path ends: its file name, and the folder it is in (short). */
function splitPath(p: string): { name: string; dir: string } {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return { name: parts.at(-1) ?? p, dir: parts.slice(-3, -1).join('/') };
}

/**
 * Claude finished a turn: how long it took, the files it changed and the commands it ran, at a
 * glance (the steps themselves are above). A long file list folds.
 */
function TurnSummary({ item }: { item: Of<'summary'> }) {
  const { c, dark } = useTheme();
  const [open, setOpen] = useState(false);
  const [first, ...rest] = summaryParts(item);
  const FOLDED = 3;
  const shown = open ? item.files : item.files.slice(0, FOLDED);
  const more = item.files.length - shown.length;
  return (
    <View
      testID="turn-summary"
      accessibilityLabel={`Claude finished: ${summaryParts(item).join(', ')}`}
      style={{
        borderRadius: radius.xl,
        borderWidth: dark ? 0 : StyleSheet.hairlineWidth,
        borderColor: c.border,
        backgroundColor: c.card,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <CircleCheck size={16} color={item.failed ? c.warning : c.success} strokeWidth={2.4} />
        <T variant="smallMedium" style={{ flexShrink: 0 }}>
          Done in {first}
        </T>
        {rest.length > 0 && (
          <T variant="small" tone="muted" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
            · {rest.join(' · ')}
          </T>
        )}
      </View>
      {shown.length > 0 && (
        <View style={{ gap: 4, paddingLeft: 24 }}>
          {shown.map((f) => {
            const { name, dir } = splitPath(f);
            return (
              <Text
                key={f}
                numberOfLines={1}
                style={{ fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 18 }}
              >
                <Text style={{ color: c.foreground }}>{name}</Text>
                {dir ? <Text style={{ color: c.mutedForeground }}>{`  ${dir}`}</Text> : null}
              </Text>
            );
          })}
          {(more > 0 || open) && item.files.length > FOLDED && (
            <Press
              accessibilityRole="button"
              onPress={() => setOpen((o) => !o)}
              hitSlop={6}
              style={{ alignSelf: 'flex-start', marginTop: 2 }}
            >
              <T variant="captionMedium" tone="primary">
                {open ? 'Show less' : `${more} more`}
              </T>
            </Press>
          )}
        </View>
      )}
    </View>
  );
}

/** A row that arrives while the chat is open rises into place (the list is inverted: up is -y). */
const arrive = (index: number) =>
  FadeInUp.duration(dur.enter + 40)
    .easing(ease.out)
    .delay(Math.min(index, 8) * STAGGER)
    .withInitialValues({ opacity: 0, transform: [{ translateY: -12 }] });

/**
 * Whether two plain values (rows built from API data: objects, arrays, strings, numbers) hold the
 * same thing. Every refresh rebuilds the rows; this lets a row that didn't change skip its render.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** One row of the list; a row that arrived after the first render rises into place. */
/** Text with the searched words marked (for a spot that isn't a component of its own). */
function Mark({ text }: { text: string }) {
  return <>{useMark()(text)}</>;
}

/** A search in the chat: the rows that match, and the one being shown. */
type Hit = 'current' | 'match' | undefined;

const ListRow = memo(
  function ListRow({
    row,
    fresh,
    hit,
    anchor,
  }: {
    row: Row;
    fresh: number | undefined;
    hit: Hit;
    /** The found word's anchor (only in the match the search went to). */
    anchor?: (node: ComponentRef<typeof View> | null) => () => void;
  }) {
    const { c } = useTheme();
    // The match the search went to lights up, then fades: the marked words stay.
    const glow = useSharedValue(0);
    useEffect(() => {
      if (hit !== 'current') return;
      glow.set(1);
      glow.set(withDelay(700, withTiming(0, { duration: 900, easing: ease.out })));
    }, [hit, glow]);
    const flash = useAnimatedStyle(() => ({ opacity: glow.value }));
    return (
      <Animated.View
        entering={fresh === undefined ? undefined : arrive(fresh)}
        style={{
          paddingHorizontal: PAD,
          paddingBottom: row.type === 'item' && isQueued(row.item) ? 12 : GAP,
        }}
        testID={hit === 'current' ? 'search-current' : undefined}
      >
        {hit === 'current' && (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                left: PAD - 8,
                right: PAD - 8,
                top: -4,
                bottom: GAP - 4,
                borderRadius: radius.lg,
                backgroundColor: alpha(c.primary, 0.18),
              },
              flash,
            ]}
          />
        )}
        {anchor ? (
          <MatchAnchor.Provider value={anchor}>
            <RowContent row={row} />
          </MatchAnchor.Provider>
        ) : (
          <RowContent row={row} />
        )}
      </Animated.View>
    );
  },
  (a, b) => a.fresh === b.fresh && a.hit === b.hit && a.anchor === b.anchor && same(a.row, b.row),
);

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
  jumpKey = 0,
  search,
}: {
  items: ChatItem[];
  typing: TypingKind | null;
  header?: ReactNode;
  footer?: ReactNode;
  /** Room left under the last message (what floats over the list: the message box). */
  bottomInset?: number;
  /** Changes when the user sends a message: the list goes back to the newest message. */
  jumpKey?: number;
  /** Searching in the chat: the matching items' keys, and the one to show (scrolled to). */
  search?: { query: string; matches: ReadonlySet<string>; current: string | null };
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
    offset.current = e.nativeEvent.contentOffset.y;
    const near = e.nativeEvent.contentOffset.y < NEAR_BOTTOM;
    if (near !== atBottom.current) {
      atBottom.current = near;
      setAway(!near);
    }
  }, []);

  const toBottom = () => list.current?.scrollToOffset({ offset: 0, animated: true });
  // Sending brings you to the bottom at once, and again when the message shows up there: rows
  // arriving mid-scroll keep the visible ones in place, which would stop the first scroll short.
  const following = useRef(0);
  useEffect(() => {
    if (!jumpKey) return;
    following.current = Date.now() + 4000;
    list.current?.scrollToOffset({ offset: 0, animated: true });
  }, [jumpKey]);
  useEffect(() => {
    if (Date.now() < following.current) list.current?.scrollToOffset({ offset: 0, animated: true });
  }, [rows]);

  // Searching: the match being shown is brought to the middle of the screen.
  const current = search?.current ?? null;
  // The found word's place: an anchor in front of each mark of the match being shown.
  const offset = useRef(0);
  const box = useRef<ComponentRef<typeof View>>(null);
  const anchors = useRef(new Set<ComponentRef<typeof View>>());
  const anchor = useCallback((node: ComponentRef<typeof View> | null) => {
    if (!node) return () => undefined;
    anchors.current.add(node);
    return () => {
      anchors.current.delete(node);
    };
  }, []);
  useEffect(() => {
    if (!current) return;
    const index = rows.findIndex((r) => r.key === current);
    if (index >= 0) list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    // The message is in view, but in a long one (or above the keyboard) the word may not be:
    // measure the word and move the chat so it sits in the middle of what is visible.
    const bring = () => {
      const nodes = [...anchors.current];
      if (!nodes.length || !box.current) return;
      box.current.measureInWindow((_x, top, _w, height) => {
        const visible = height - bottomInset;
        let first: number | null = null;
        let left = nodes.length;
        for (const n of nodes)
          n.measureInWindow((_nx, y) => {
            if (first === null || y < first) first = y;
            if (--left > 0 || first === null) return;
            if (first >= top + 56 && first <= top + visible - 56) return;
            list.current?.scrollToOffset({
              offset: Math.max(0, offset.current - (first - (top + visible / 2))),
              animated: true,
            });
          });
      });
    };
    const t1 = setTimeout(bring, 450);
    const t2 = setTimeout(bring, 1000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // Only when the match changes, not as rows arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    // Not laid out yet: go near it, then try again once it is.
    list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(
      () => list.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }),
      120,
    );
  }, []);

  const matches = search?.matches;
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Row>) => (
      <ListRow
        row={item}
        fresh={fresh.get(item.key)}
        hit={item.key === current ? 'current' : matches?.has(item.key) ? 'match' : undefined}
        {...(item.key === current ? { anchor } : {})}
      />
    ),
    [fresh, current, matches, anchor],
  );

  return (
    <View ref={box} collapsable={false} style={{ flex: 1, minHeight: 0 }}>
      {/* Searching: every message marks the searched words. */}
      <SearchQuery.Provider value={search?.query ?? ''}>
        <FlatList
          ref={list}
          inverted
          testID="timeline"
          accessibilityLabel="Conversation"
          data={rows}
          extraData={[fresh, current, matches]}
          onScrollToIndexFailed={onScrollToIndexFailed}
          renderItem={renderItem}
          keyExtractor={rowKey}
          // Scrolled up, new messages don't move what you are reading; at the bottom they come in.
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: NEAR_BOTTOM }}
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          // Rows are heavy (Markdown, code): keep fewer screens mounted around what is visible.
          windowSize={7}
          onScroll={onScroll}
          scrollEventThrottle={32}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          // Inverted, the header sits under the newest message and the footer above the oldest.
          ListHeaderComponent={
            // Room between the newest message and the floating message box.
            <View style={{ paddingBottom: bottomInset + 20 }}>
              {footer ? <View style={{ paddingHorizontal: PAD, paddingBottom: GAP }}>{footer}</View> : null}
            </View>
          }
          ListFooterComponent={
            <View style={{ paddingHorizontal: PAD, paddingTop: PAD, paddingBottom: header ? GAP : 0 }}>
              {header}
            </View>
          }
          ListEmptyComponent={
            <T
              variant="small"
              tone="muted"
              center
              style={{ paddingVertical: 40, transform: [{ scaleY: -1 }] }}
            >
              No messages yet.
            </T>
          }
        />
      </SearchQuery.Provider>
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
