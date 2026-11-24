import type { AskedQuestion } from '@pocket-agent/core';
import type { ApprovalDto } from '@pocket-agent/protocol';
import { ChevronLeft, ChevronRight, Send } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { FadeInLeft, FadeInRight, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dur, ease, enter, exit, layout } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { buzz, Divider, Press, T, tap } from '@/ui/core';
import { Notice } from '@/ui/feedback';
import { AnswerButtons, BigButton, CountdownInline, OptionMark, SentNote, SheetFrame } from './parts';
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
  onChosen,
}: {
  q: AskedQuestion;
  pick: Pick;
  onPick: (p: Pick) => void;
  disabled: boolean;
  timer?: ReactNode;
  /** A single choice was ticked (not "Other", which still needs typing): the pager moves on. */
  onChosen?: () => void;
}) {
  const { c, dark } = useTheme();
  const otherOn = pick.labels.includes(OTHER);
  const choose = (label: string) => {
    if (q.multiSelect) {
      const on = pick.labels.includes(label);
      onPick({ ...pick, labels: on ? pick.labels.filter((l) => l !== label) : [...pick.labels, label] });
    } else {
      onPick({ labels: [label], other: label === OTHER ? pick.other : '' });
      if (label !== OTHER) onChosen?.();
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

  // Several questions: one per page, Previous / Next (or a swipe), Submit on the last.
  const last = questions.length - 1;
  const paged = last > 0;
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  // A tick queues the next page; it turns a beat later, so the tick is seen first.
  const [queued, setQueued] = useState<number | null>(null);
  useEffect(() => {
    if (queued === null) return;
    const t = setTimeout(() => {
      setQueued(null);
      setDir(1);
      setPage(queued);
    }, 280);
    return () => clearTimeout(t);
  }, [queued]);
  const go = (to: number) => {
    setQueued(null);
    const next = Math.min(last, Math.max(0, to));
    if (next === page) return;
    setDir(next > page ? 1 : -1);
    setPage(next);
  };
  const swipeTo = (to: number) => {
    if (to < 0 || to > last) return;
    tap();
    go(to);
  };
  const swipe = usePanGesture({
    enabled: paged,
    activeOffsetX: [-20, 20],
    failOffsetY: [-12, 12],
    onDeactivate: (e) => {
      'worklet';
      if (e.translationX < -60 || e.velocityX < -500) scheduleOnRN(swipeTo, page + 1);
      else if (e.translationX > 60 || e.velocityX > 500) scheduleOnRN(swipeTo, page - 1);
    },
  });
  // Submit with a question still unanswered: that question is shown rather than refused.
  const submit = () => {
    const open = questions.findIndex((q) => !answers[q.question]);
    if (open >= 0) {
      buzz(false);
      go(open);
      return;
    }
    void decide('allow');
  };

  const timer = <CountdownInline left={left} accent="primary" />;
  const block = (q: AskedQuestion, withTimer: boolean, onChosen?: () => void) => (
    <QuestionBlock
      key={q.question}
      q={q}
      pick={picks[q.question] ?? NO_PICK}
      onPick={(p) => setPicks((prev) => ({ ...prev, [q.question]: p }))}
      disabled={!!busy || !!sent || expired}
      {...(withTimer ? { timer } : {})}
      {...(onChosen ? { onChosen } : {})}
    />
  );
  const autoNext = page < last ? () => setQueued(page + 1) : undefined;

  return (
    <SheetFrame accent={c.primary} testID="question-sheet">
      {paged && (
        <View
          accessibilityLabel={`Question ${page + 1} of ${questions.length}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 16,
            paddingTop: 14,
          }}
        >
          {questions.map((q, i) => (
            <Press
              key={q.question}
              accessibilityRole="button"
              accessibilityLabel={`Question ${i + 1}`}
              onPress={() => go(i)}
              scale={1}
              style={{ flex: 1, paddingVertical: 8 }}
            >
              <View
                style={{
                  height: 4,
                  borderRadius: radius.full,
                  backgroundColor:
                    i === page
                      ? c.primary
                      : answers[q.question]
                        ? alpha(c.primary, 0.45)
                        : alpha(c.mutedForeground, 0.25),
                }}
              />
            </Press>
          ))}
          <T variant="captionMedium" tone="muted" style={{ marginLeft: 6 }}>
            {page + 1} of {questions.length}
          </T>
        </View>
      )}
      <GestureDetector gesture={swipe}>
        <ScrollView
          style={{ maxHeight: Math.round(height * 0.5) }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: paged ? 8 : 16,
            paddingBottom: 8,
            gap: 24,
          }}
        >
          {paged ? (
            <Animated.View
              key={page}
              entering={(dir > 0 ? FadeInRight : FadeInLeft).duration(dur.enter).easing(ease.out)}
            >
              {block(questions[page]!, true, autoNext)}
            </Animated.View>
          ) : (
            questions.map((q, i) => block(q, i === 0))
          )}
        </ScrollView>
      </GestureDetector>
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
        ) : paged ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {page === 0 ? (
              <BigButton
                label={busy === 'deny' ? 'Skipping…' : 'Skip'}
                look="outline"
                grow={false}
                loading={busy === 'deny'}
                disabled={!!busy || expired}
                onPress={() => void decide('deny')}
                testID="skip"
              />
            ) : (
              <BigButton
                label="Previous"
                icon={ChevronLeft}
                look="outline"
                disabled={!!busy}
                onPress={() => go(page - 1)}
                testID="question-previous"
              />
            )}
            {page < last ? (
              <BigButton
                label="Next"
                icon={ChevronRight}
                disabled={!!busy || expired}
                onPress={() => go(page + 1)}
                testID="question-next"
              />
            ) : (
              <BigButton
                label={busy === 'allow' ? 'Sending…' : 'Submit'}
                icon={Send}
                loading={busy === 'allow'}
                disabled={!!busy || expired}
                onPress={submit}
                testID="send-answer"
              />
            )}
          </View>
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
