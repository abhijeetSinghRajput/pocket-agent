import type { AskedQuestion } from '@pocket-agent/core';
import type { ApprovalDto } from '@pocket-agent/protocol';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dur, ease, enter, exit, layout } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { buzz, Divider, Press, T } from '@/ui/core';
import { Notice } from '@/ui/feedback';
import { AnswerButtons, CountdownInline, OptionMark, SentNote, SheetFrame } from './parts';
import {
  answerText,
  NO_PICK,
  sendDecision,
  sentText,
  SKIP_MESSAGE,
  useCountdown,
  type Decision,
  type Pick,
} from './shared';

/** "Other" is a choice of its own in the list; it never reaches Claude as a label. */
const OTHER = '\u0000other';

function Option({
  selected,
  multi,
  title,
  hint,
  disabled,
  onSelect,
  children,
}: {
  selected: boolean;
  multi: boolean;
  title: string;
  hint?: string;
  disabled: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  const { c } = useTheme();
  // The chosen row tints in rather than switching on.
  const tint = useAnimatedStyle(() => ({
    backgroundColor: withTiming(selected ? alpha(c.primary, 0.1) : alpha(c.primary, 0), {
      duration: dur.quick,
      easing: ease.out,
    }),
  }));
  return (
    <Animated.View style={tint} layout={layout}>
      <Press
        accessibilityRole={multi ? 'checkbox' : 'radio'}
        accessibilityState={{ checked: selected, disabled }}
        accessibilityLabel={title}
        disabled={disabled}
        onPress={onSelect}
        scale={0.99}
        dim={false}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 14,
          minHeight: 52,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="subheading" style={{ fontSize: 15, lineHeight: 21 }}>
            {title}
          </T>
          {hint ? (
            <T variant="small" tone="muted" style={{ fontSize: 13, lineHeight: 18, marginTop: 2 }}>
              {hint}
            </T>
          ) : null}
        </View>
        <OptionMark on={selected} multi={multi} size={24} />
      </Press>
      {children}
    </Animated.View>
  );
}

function QuestionBlock({
  q,
  pick,
  onPick,
  disabled,
  timer,
}: {
  q: AskedQuestion;
  pick: Pick;
  onPick: (p: Pick) => void;
  disabled: boolean;
  timer?: ReactNode;
}) {
  const { c, dark } = useTheme();
  const otherOn = pick.labels.includes(OTHER);
  const choose = (label: string) => {
    if (q.multiSelect) {
      const on = pick.labels.includes(label);
      onPick({ ...pick, labels: on ? pick.labels.filter((l) => l !== label) : [...pick.labels, label] });
    } else {
      onPick({ labels: [label], other: label === OTHER ? pick.other : '' });
    }
  };
  return (
    <View accessibilityLabel={q.question} style={{ minWidth: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <T
          variant="overline"
          tone="primary"
          numberOfLines={1}
          style={{ flex: 1, fontSize: 11.5, letterSpacing: 0.8, textTransform: 'uppercase' }}
        >
          {q.header || 'Claude is asking'}
        </T>
        {timer}
      </View>
      <T variant="heading" style={{ marginTop: 6 }}>
        {q.question}
      </T>
      {q.multiSelect && (
        <T variant="small" tone="muted" style={{ marginTop: 2 }}>
          Pick any
        </T>
      )}
      <View
        accessibilityRole={q.multiSelect ? 'none' : 'radiogroup'}
        accessibilityLabel={q.question}
        style={{
          marginTop: 12,
          borderRadius: radius.xl,
          borderWidth: dark ? 0 : StyleSheet.hairlineWidth,
          borderColor: c.border,
          backgroundColor: c.card,
          overflow: 'hidden',
        }}
      >
        {q.options.map((o) => (
          <View key={o.label}>
            <Option
              selected={pick.labels.includes(o.label)}
              multi={q.multiSelect}
              title={o.label}
              hint={o.description || undefined}
              disabled={disabled}
              onSelect={() => choose(o.label)}
            />
            <Divider />
          </View>
        ))}
        <Option
          selected={otherOn}
          multi={q.multiSelect}
          title="Other"
          hint="Type your own answer"
          disabled={disabled}
          onSelect={() => choose(OTHER)}
        >
          {otherOn && (
            <Animated.View
              entering={enter.fade}
              exiting={exit.fade}
              style={{ paddingHorizontal: 16, paddingBottom: 14 }}
            >
              <TextInput
                accessibilityLabel="Your own answer"
                autoFocus
                maxLength={300}
                value={pick.other}
                editable={!disabled}
                onChangeText={(text) => onPick({ ...pick, other: text })}
                placeholder="Your answer"
                placeholderTextColor={c.mutedForeground}
                selectionColor={c.primary}
                style={{
                  height: 46,
                  borderRadius: radius.lg,
                  borderWidth: StyleSheet.hairlineWidth * 2,
                  borderColor: c.input,
                  backgroundColor: c.background,
                  paddingHorizontal: 12,
                  paddingVertical: 0,
                  fontFamily: fonts.regular,
                  fontSize: 16,
                  color: c.foreground,
                }}
              />
            </Animated.View>
          )}
        </Option>
      </View>
    </View>
  );
}

/**
 * Claude's question, docked at the bottom of the chat in place of the message box: pick an
 * option (or type your own), then send. Skip lets Claude carry on without an answer.
 */
export function QuestionSheet({
  approval,
  questions,
  onDone,
}: {
  approval: ApprovalDto;
  questions: AskedQuestion[];
  onDone: () => void;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const left = useCountdown(approval.expiresAt);
  const expired = left <= 0;
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busy, setBusy] = useState<Decision | null>(null);
  const [sent, setSent] = useState<Decision | null>(approval.decision);
  const [error, setError] = useState<string | null>(null);

  // "Other" is a choice of its own; what Claude receives is the typed words.
  const answers = Object.fromEntries(
    questions.map((q) => {
      const p = picks[q.question] ?? NO_PICK;
      const labels = p.labels.filter((l) => l !== OTHER);
      return [q.question, answerText(q, { labels, other: p.labels.includes(OTHER) ? p.other : '' })];
    }),
  );
  const complete = questions.every((q) => answers[q.question]);

  async function decide(decision: Decision) {
    setBusy(decision);
    setError(null);
    try {
      await sendDecision(
        approval.id,
        decision === 'allow' ? { decision, answers } : { decision, message: SKIP_MESSAGE },
      );
      buzz(true);
      setSent(decision);
      onDone();
    } catch (err) {
      buzz(false);
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const timer = <CountdownInline left={left} accent="primary" />;

  return (
    <SheetFrame accent={c.primary} testID="question-sheet">
      <ScrollView
        style={{ maxHeight: Math.round(height * 0.5) }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 24 }}
      >
        {questions.map((q, i) => (
          <QuestionBlock
            key={q.question}
            q={q}
            pick={picks[q.question] ?? NO_PICK}
            onPick={(p) => setPicks((prev) => ({ ...prev, [q.question]: p }))}
            disabled={!!busy || !!sent || expired}
            {...(i === 0 ? { timer } : {})}
          />
        ))}
      </ScrollView>
      <Animated.View
        layout={layout}
        style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 + insets.bottom, gap: 12 }}
      >
        <T variant="caption" tone="muted">
          Sent straight to your PC. If the timer runs out, Claude carries on without it.
        </T>
        {error && <Notice>{error}</Notice>}
        {sent ? (
          <SentNote text={sentText(sent, true)} />
        ) : (
          <AnswerButtons
            busy={busy}
            disabled={expired}
            complete={complete}
            sendLabel="Choose an answer"
            onDecide={(d) => void decide(d)}
          />
        )}
      </Animated.View>
    </SheetFrame>
  );
}
