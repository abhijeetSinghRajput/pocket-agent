import { parseQuestions, timeAgo, toolTarget, type AskedQuestion } from '@pocket-agent/core';
import type { ApprovalDto } from '@pocket-agent/protocol';
import { useRouter } from 'expo-router';
import { MessageCircleQuestion, ShieldAlert } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { dur, ease, layout } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { buzz, Card, Press, T } from '@/ui/core';
import { Notice } from '@/ui/feedback';
import { CodeBlock } from '@/ui/code-block';
import { AnswerButtons, CountdownPill, DecisionButtons, OptionMark, SentNote } from './parts';
import {
  answerText,
  describeRequest,
  NO_PICK,
  readableInput,
  sendDecision,
  sentText,
  SKIP_MESSAGE,
  timeoutText,
  useCountdown,
  type Decision,
  type Pick,
} from './shared';

/** One option of a question in the card: a compact row with its mark, label and description. */
function OptionRow({
  label,
  description,
  on,
  multi,
  disabled,
  onPress,
}: {
  label: string;
  description?: string;
  on: boolean;
  multi: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  const look = useAnimatedStyle(() => ({
    borderColor: withTiming(on ? c.primary : c.border, { duration: dur.quick, easing: ease.out }),
    backgroundColor: withTiming(on ? alpha(c.primary, 0.1) : c.card, {
      duration: dur.quick,
      easing: ease.out,
    }),
  }));
  return (
    <Press
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      scale={0.985}
      dim={false}
    >
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            minHeight: 44,
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth * 2,
          },
          look,
        ]}
      >
        <View style={{ paddingTop: 2 }}>
          <OptionMark on={on} multi={multi} size={18} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="smallMedium">{label}</T>
          {description ? (
            <T variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {description}
            </T>
          ) : null}
        </View>
      </Animated.View>
    </Press>
  );
}

/** Claude's questions with tappable options: one choice (or several, if Claude allows) plus free text. */
function QuestionForm({
  questions,
  picks,
  onPick,
  disabled,
}: {
  questions: AskedQuestion[];
  picks: Record<string, Pick>;
  onPick: (question: string, pick: Pick) => void;
  disabled: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      {questions.map((q, qi) => {
        const pick = picks[q.question] ?? NO_PICK;
        const toggle = (label: string) => {
          if (q.multiSelect) {
            const on = pick.labels.includes(label);
            onPick(q.question, {
              ...pick,
              labels: on ? pick.labels.filter((l) => l !== label) : [...pick.labels, label],
            });
          } else {
            // One choice: picking an option replaces a typed answer, and the other way round.
            onPick(q.question, { labels: [label], other: '' });
          }
        };
        return (
          <View
            key={qi}
            accessibilityLabel={q.question}
            style={{
              borderRadius: radius.lg,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.border,
              backgroundColor: alpha(c.muted, 0.3),
              padding: 12,
              gap: 8,
            }}
          >
            {q.header ? (
              <View
                style={{
                  alignSelf: 'flex-start',
                  backgroundColor: c.accent,
                  borderRadius: radius.full,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                }}
              >
                <T
                  variant="captionMedium"
                  style={{ color: c.accentForeground, fontSize: 11, lineHeight: 15 }}
                >
                  {q.header}
                </T>
              </View>
            ) : null}
            <View>
              <T variant="smallMedium">{q.question}</T>
              {q.multiSelect && (
                <T variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  Pick any
                </T>
              )}
            </View>
            <View
              accessibilityRole={q.multiSelect ? 'none' : 'radiogroup'}
              accessibilityLabel={q.question}
              style={{ gap: 6 }}
            >
              {q.options.map((o) => (
                <OptionRow
                  key={o.label}
                  label={o.label}
                  description={o.description || undefined}
                  on={pick.labels.includes(o.label)}
                  multi={q.multiSelect}
                  disabled={disabled}
                  onPress={() => toggle(o.label)}
                />
              ))}
            </View>
            <TextInput
              accessibilityLabel={`Your own answer to: ${q.question}`}
              value={pick.other}
              maxLength={300}
              editable={!disabled}
              placeholder="Other: type your own answer"
              placeholderTextColor={c.mutedForeground}
              selectionColor={c.primary}
              onChangeText={(text) =>
                onPick(q.question, {
                  labels: q.multiSelect || !text ? pick.labels : [],
                  other: text,
                })
              }
              style={{
                height: 42,
                borderRadius: radius.md,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: c.input,
                backgroundColor: c.card,
                paddingHorizontal: 12,
                paddingVertical: 0,
                fontFamily: fonts.regular,
                fontSize: 15,
                color: c.foreground,
                opacity: disabled ? 0.6 : 1,
              }}
            />
          </View>
        );
      })}
    </View>
  );
}

/** One pending permission request, with everything needed to decide on a phone. */
export function ApprovalCard({ approval, onDecided }: { approval: ApprovalDto; onDecided: () => void }) {
  const { c } = useTheme();
  const router = useRouter();
  const left = useCountdown(approval.expiresAt);
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Decision | null>(approval.decision);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const target = toolTarget(approval.input);
  const expired = left <= 0;

  async function decide(decision: Decision, extra: Record<string, unknown> = {}) {
    setBusy(decision);
    setError(null);
    try {
      await sendDecision(approval.id, { decision, ...extra });
      buzz(true);
      setSent(decision);
      onDecided();
    } catch (err) {
      buzz(false);
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const what = describeRequest(approval.toolName);
  const shown = target || readableInput(approval.input);
  const asking = approval.toolName === 'AskUserQuestion';
  const questions = asking ? parseQuestions(approval.input) : [];
  // Claude's question: answered right here (the options are the buttons), not allowed or denied.
  const answering = asking && questions.length > 0;
  const answers = Object.fromEntries(questions.map((q) => [q.question, answerText(q, picks[q.question])]));
  const complete = answering && questions.every((q) => answers[q.question]);
  const accent = answering ? c.primary : c.warning;
  const HeaderIcon = answering ? MessageCircleQuestion : ShieldAlert;

  // The header fades from warning to its settled state once the decision is out.
  const headerTint = useAnimatedStyle(() => ({
    backgroundColor: withTiming(
      interpolateColor(sent ? 1 : 0, [0, 1], [alpha(accent, 0.08), alpha(c.muted, 0.4)]),
      { duration: dur.enter, easing: ease.out },
    ),
  }));

  return (
    <View testID="approval-card">
      <Card style={{ overflow: 'hidden' }}>
        <Animated.View
          layout={layout}
          style={[
            {
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 12,
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: c.border,
            },
            headerTint,
          ]}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: alpha(accent, answering ? 0.15 : 0.2),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <HeaderIcon size={18} color={accent} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="subheading" style={{ fontSize: 15, lineHeight: 20 }}>
              {answering ? 'Claude is asking you' : `Claude wants to ${what.verb}`}
            </T>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, minWidth: 0 }}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Open chat ${approval.projectName}`}
                hitSlop={6}
                onPress={() => router.push({ pathname: '/chat/[id]', params: { id: approval.sessionId } })}
                style={{ flexShrink: 1 }}
              >
                <T variant="captionMedium" numberOfLines={1}>
                  {approval.projectName}
                </T>
              </Pressable>
              <T variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {' '}
                · {approval.deviceName} · {timeAgo(approval.createdAt)}
              </T>
            </View>
          </View>
          <CountdownPill left={left} />
        </Animated.View>

        {answering ? (
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }} testID="approval-questions">
            <QuestionForm
              questions={questions}
              picks={picks}
              onPick={(q, pick) => setPicks((prev) => ({ ...prev, [q]: pick }))}
              disabled={!!busy || !!sent || expired}
            />
            <T variant="caption" tone="muted">
              Your answer goes straight to Claude on your PC. Not answered in time: Claude carries on without
              it.
            </T>
          </View>
        ) : (
          // Exactly what will run: the decision applies to this, unchanged.
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 6 }}>
            <T
              variant="overline"
              tone="muted"
              style={{ fontSize: 11, lineHeight: 15, letterSpacing: 0.6, textTransform: 'uppercase' }}
            >
              {what.label} · {approval.toolName}
            </T>
            {asking ? (
              <View
                testID="approval-questions"
                style={{
                  borderRadius: radius.md,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: c.border,
                  backgroundColor: alpha(c.muted, 0.4),
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              >
                <T variant="small" tone="muted">
                  Update Pocket Agent on your PC to see and answer Claude’s question here.
                </T>
              </View>
            ) : (
              <CodeBlock text={shown} shell={what.shell} maxHeight={224} />
            )}
            <T variant="caption" tone="muted">
              {timeoutText(approval.sessionMode)}
            </T>
          </View>
        )}

        <Animated.View
          layout={layout}
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
            backgroundColor: alpha(c.muted, 0.3),
            paddingHorizontal: 16,
            paddingVertical: 12,
            gap: 8,
          }}
        >
          {sent ? (
            <SentNote text={sentText(sent, answering)} />
          ) : answering ? (
            <AnswerButtons
              busy={busy}
              disabled={expired}
              complete={complete}
              onDecide={(d) =>
                void (d === 'allow'
                  ? decide('allow', { answers })
                  : decide('deny', { message: SKIP_MESSAGE }))
              }
            />
          ) : (
            <DecisionButtons busy={busy} disabled={expired} onDecide={(d) => void decide(d)} />
          )}
          {error && <Notice>{error}</Notice>}
        </Animated.View>
      </Card>
    </View>
  );
}
