import { agentName, requestTarget } from '@pocket-agent/core';
import type { ApprovalDto } from '@pocket-agent/protocol';
import { useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layout } from '@/lib/motion';
import { T } from '@/ui/core';
import { Notice } from '@/ui/feedback';
import { CodeBlock } from '@/ui/code-block';
import { CountdownInline, PermissionDecision, SheetFrame } from './parts';
import {
  describeRequest,
  readableInput,
  requestPurpose,
  timeoutText,
  useCountdown,
  useDecision,
} from './shared';

/**
 * A permission request, docked at the bottom of the chat in place of the message box (like
 * Claude's questions): what the agent wants to do, exactly what will run, then Deny or Allow.
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
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const left = useCountdown(approval.expiresAt);
  const expired = left <= 0;
  const decision = useDecision(approval, onDone);
  const what = describeRequest(approval.toolName);
  const shown = requestTarget(approval.toolName, approval.input) || readableInput(approval.input);
  const purpose = requestPurpose(approval.input);

  return (
    <SheetFrame testID="permission-sheet">
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
          {agentName(approval.provider)} wants to {what.verb}
        </T>
        <T variant="small" tone="muted">
          {what.label} · {approval.toolName}
        </T>
        {purpose && (
          <T variant="small" numberOfLines={4} style={{ marginTop: 8 }}>
            {purpose}
          </T>
        )}
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
        {decision.error && <Notice>{decision.error}</Notice>}
        <PermissionDecision approval={approval} decision={decision} expired={expired} />
      </Animated.View>
    </SheetFrame>
  );
}
