import { toolTarget } from '@pocket-agent/core';
import type { ApprovalDto } from '@pocket-agent/protocol';
import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layout } from '@/lib/motion';
import { useTheme } from '@/lib/theme';
import { buzz, T } from '@/ui/core';
import { Notice } from '@/ui/feedback';
import { CodeBlock } from '@/ui/code-block';
import { CountdownInline, DecisionButtons, SentNote, SheetFrame } from './parts';
import {
  describeRequest,
  readableInput,
  sendDecision,
  sentText,
  timeoutText,
  useCountdown,
  type Decision,
} from './shared';

/**
 * A permission request, docked at the bottom of the chat in place of the message box (like
 * Claude's questions): what Claude wants to do, exactly what will run, then Deny or Allow.
 */
export function PermissionSheet({
  approval,
  more,
  onDone,
}: {
  approval: ApprovalDto;
  /** How many other requests wait after this one. */
  more: number;
  onDone: () => void;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const left = useCountdown(approval.expiresAt);
  const expired = left <= 0;
  const [busy, setBusy] = useState<Decision | null>(null);
  const [sent, setSent] = useState<Decision | null>(approval.decision);
  const [error, setError] = useState<string | null>(null);
  const what = describeRequest(approval.toolName);
  const shown = toolTarget(approval.input) || readableInput(approval.input);

  async function decide(decision: Decision) {
    setBusy(decision);
    setError(null);
    try {
      await sendDecision(approval.id, { decision });
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

  return (
    <SheetFrame accent={c.warning} testID="permission-sheet">
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 2 }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
        >
          <T
            variant="overline"
            tone="warning"
            numberOfLines={1}
            style={{ flex: 1, fontSize: 11.5, letterSpacing: 0.8, textTransform: 'uppercase' }}
          >
            Permission needed{more > 0 ? ` · ${more} more waiting` : ''}
          </T>
          <CountdownInline left={left} accent="warning" />
        </View>
        <T variant="heading" style={{ marginTop: 6 }}>
          Claude wants to {what.verb}
        </T>
        <T variant="small" tone="muted">
          {what.label} · {approval.toolName}
        </T>
        {/* Exactly what will run: the decision applies to this, unchanged. */}
        <CodeBlock
          text={shown}
          shell={what.shell}
          maxHeight={Math.round(height * 0.3)}
          style={{ marginTop: 12 }}
        />
      </View>
      <Animated.View
        layout={layout}
        style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 + insets.bottom, gap: 12 }}
      >
        <T variant="caption" tone="muted">
          {timeoutText(approval.sessionMode)}
        </T>
        {error && <Notice>{error}</Notice>}
        {sent ? (
          <SentNote text={sentText(sent, false)} />
        ) : (
          <DecisionButtons busy={busy} disabled={expired} onDecide={(d) => void decide(d)} />
        )}
      </Animated.View>
    </SheetFrame>
  );
}
