import { PAIRING_CODE_TTL_MS } from '@pocket-agent/protocol';
import { mmss } from '@pocket-agent/core';
import { Check, Clock, RefreshCw, Share2 } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { PairingStep } from '@/features/devices/use-pairing';
import { ScanPcButton } from '@/features/devices/pair-scanner';
import { AGENT_NPM_PACKAGE, connectCommand, installCommand } from '@/lib/api';
import { dur, ease, enter, exit, layout } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { Button, Divider, T, tap } from '@/ui/core';
import { CopyButton } from '@/ui/copy';
import { Notice, Skeleton } from '@/ui/feedback';

type StepState = 'todo' | 'current' | 'done';

/** The step's number: the brand colour while it is to do, green with a tick once done. */
function StepNumber({ n, state }: { n: number; state: StepState }) {
  const { c } = useTheme();
  const done = useSharedValue(state === 'done' ? 1 : 0);
  useEffect(() => {
    done.set(withTiming(state === 'done' ? 1 : 0, { duration: dur.enter, easing: ease.out }));
  }, [state, done]);
  const fill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(done.value, [0, 1], [c.primary, c.success]),
  }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
        fill,
      ]}
    >
      {state === 'done' ? (
        <Animated.View key="done" entering={enter.pop} exiting={exit.fade}>
          <Check size={17} color="#ffffff" strokeWidth={3} />
        </Animated.View>
      ) : (
        <Animated.View key="n" entering={enter.pop} exiting={exit.fade}>
          <T variant="smallMedium" style={{ color: c.primaryForeground, fontFamily: fonts.semibold }}>
            {n}
          </T>
        </Animated.View>
      )}
    </Animated.View>
  );
}

function Step({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  children: ReactNode;
}) {
  return (
    <View style={{ padding: 20, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <StepNumber n={n} state={state} />
        <T
          variant="heading"
          accessibilityRole="header"
          accessibilityLabel={`Step ${n}${state === 'done' ? ' (done)' : ''}: ${title}`}
          style={{ flex: 1 }}
        >
          {title}
        </T>
      </View>
      {children}
    </View>
  );
}

/**
 * A command to run, drawn as a small terminal: a "Terminal" bar with Copy, then the command.
 * `accent` is the part shown in the brand colour (the package, the pairing code).
 */
function TerminalBox({ command, accent, expired }: { command: string; accent: string; expired?: boolean }) {
  const { c, dark } = useTheme();
  const [program = '', ...rest] = command.split(' ');
  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        backgroundColor: dark ? c.code : alpha(c.background, 0.6),
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          height: 44,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: 16,
          paddingRight: 8,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: c.border,
        }}
      >
        <T variant="overline" tone="muted" style={{ letterSpacing: 1.6 }}>
          TERMINAL
        </T>
        {expired ? (
          <Animated.View
            entering={enter.fade}
            style={{
              paddingHorizontal: 10,
              height: 22,
              borderRadius: radius.full,
              backgroundColor: c.muted,
              justifyContent: 'center',
              marginRight: 8,
            }}
          >
            <T variant="captionMedium" tone="muted">
              Expired
            </T>
          </Animated.View>
        ) : (
          <CopyButton value={command} />
        )}
      </View>
      <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
        <T
          variant="mono"
          selectable
          testID={accent === AGENT_NPM_PACKAGE ? 'install-command' : 'pairing-command'}
          style={expired ? { color: c.mutedForeground, textDecorationLine: 'line-through' } : undefined}
        >
          {expired ? (
            command
          ) : (
            <>
              <T variant="mono" style={{ fontFamily: fonts.monoMedium }}>
                {program}
              </T>{' '}
              {rest.map((word, i) => (
                <T
                  key={i}
                  variant="mono"
                  style={
                    word === accent
                      ? { fontFamily: fonts.monoMedium, color: c.primary }
                      : { color: c.mutedForeground }
                  }
                >
                  {word}
                  {i < rest.length - 1 ? ' ' : ''}
                </T>
              ))}
            </>
          )}
        </T>
      </View>
    </View>
  );
}

/** A countdown: shrinks steadily, one linear step per second, from the left. */
function CountdownBar({ fraction }: { fraction: number }) {
  const { c } = useTheme();
  const scale = useSharedValue(fraction);
  useEffect(() => {
    scale.set(withTiming(fraction, { duration: 1000, easing: Easing.linear }));
  }, [fraction, scale]);
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: scale.value }] }));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ height: 6, borderRadius: 3, backgroundColor: c.muted, overflow: 'hidden' }}
    >
      <Animated.View
        style={[
          { height: 6, borderRadius: 3, backgroundColor: c.primary, width: '100%', transformOrigin: 'left' },
          bar,
        ]}
      />
    </View>
  );
}

/** The two commands as one text, for the share sheet (typed on the PC while the phone is in hand). */
function shareCommands(code: string) {
  tap();
  const message = `Connect your PC to Pocket Agent (run in PowerShell):\n\n${installCommand()}\n${connectCommand(code)}\n\nThe code is single use and expires in ${PAIRING_CODE_TTL_MS / 60_000} minutes.`;
  void Share.share({ message, title: 'Connect your PC to Pocket Agent' }).catch(() => undefined);
}

/**
 * The two things to run on a PC: install once, then connect with this code (counting down, and
 * replaced in place once it expires). Shared by the onboarding screen and the Add device sheet.
 */
export function ConnectSteps({
  step,
  now,
  regenerate,
  footer,
}: {
  step: PairingStep;
  now: number;
  regenerate: () => void;
  /** Shown under the steps while waiting (live status). */
  footer?: ReactNode;
}) {
  const { c, dark } = useTheme();
  const paired = step.kind === 'paired';
  const expired = step.kind === 'expired';
  const left = step.kind === 'code' ? Math.max(0, Math.min(step.expiresAt - now, PAIRING_CODE_TTL_MS)) : 0;
  const code = step.kind === 'code' || step.kind === 'expired' ? step.code : '';

  return (
    <Animated.View
      layout={layout}
      testID="connect-steps"
      style={{
        backgroundColor: c.card,
        borderRadius: radius.xxl,
        borderWidth: dark ? 0 : StyleSheet.hairlineWidth,
        borderColor: c.border,
        overflow: 'hidden',
      }}
    >
      <Step n={1} title="Install Pocket Agent" state={paired ? 'done' : 'current'}>
        <TerminalBox command={installCommand()} accent={AGENT_NPM_PACKAGE} />
        <T variant="small" tone="muted">
          Needs Node.js 24 or newer. Already installed? Skip this step.
        </T>
      </Step>
      <Divider />

      <Step n={2} title="Connect this PC" state={paired ? 'done' : 'current'}>
        {step.kind === 'creating' && (
          <Animated.View key="creating" entering={enter.fade} exiting={exit.fade}>
            <Skeleton height={100} round={radius.lg} />
          </Animated.View>
        )}
        {step.kind === 'error' && (
          <Animated.View key="error" entering={enter.fade} exiting={exit.fade} style={{ gap: 12 }}>
            <Notice>{step.message}</Notice>
            <Button label="Try again" icon={RefreshCw} variant="outline" size="sm" onPress={regenerate} />
          </Animated.View>
        )}
        {(step.kind === 'code' || expired) && (
          <Animated.View key="code" entering={enter.fade} exiting={exit.fade} style={{ gap: 16 }}>
            <TerminalBox command={connectCommand(code)} accent={code} expired={expired} />
            <View style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <T variant="small" tone="muted" style={{ flexShrink: 1 }}>
                  Code{' '}
                  <T variant="mono" testID="pairing-code" style={{ fontFamily: fonts.monoMedium }}>
                    {code}
                  </T>{' '}
                  · single use
                </T>
                <View
                  accessibilityLiveRegion="polite"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }}
                >
                  <Clock size={15} color={c.mutedForeground} strokeWidth={2} />
                  {expired ? (
                    <T variant="small" tone="muted">
                      Expired
                    </T>
                  ) : (
                    <T variant="small" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
                      Expires in{' '}
                      <T
                        variant="smallMedium"
                        style={{ fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] }}
                      >
                        {mmss(left)}
                      </T>
                    </T>
                  )}
                </View>
              </View>
              <CountdownBar fraction={left / PAIRING_CODE_TTL_MS} />
            </View>
          </Animated.View>
        )}
        {paired && (
          <Animated.View key="paired" entering={enter.fade} exiting={exit.fade}>
            <T variant="small">
              <T variant="smallMedium">{step.device.name}</T> used the code. Finishing setup on the PC…
            </T>
          </Animated.View>
        )}
      </Step>

      {step.kind === 'code' && (
        <Animated.View key="share" entering={enter.fade} exiting={exit.fade}>
          <Divider />
          <View style={{ paddingHorizontal: 20, paddingVertical: 16, gap: 12 }}>
            <Button
              label="Share commands"
              icon={Share2}
              variant="secondary"
              full
              onPress={() => shareCommands(code)}
              testID="share-commands"
            />
            {/* No typing: the PC shows a QR code when connect has no code (Pocket Agent 2.0+). */}
            <T variant="small" tone="muted" center>
              Or run{' '}
              <T variant="mono" style={{ fontSize: 13 }}>
                pocket-agent connect
              </T>{' '}
              without a code and scan the QR code it shows:
            </T>
            <ScanPcButton />
          </View>
        </Animated.View>
      )}

      {expired && (
        <Animated.View key="expired" entering={enter.fade} exiting={exit.fade} testID="code-expired">
          <Divider />
          <View style={{ padding: 20, gap: 16 }}>
            <View style={{ gap: 4 }}>
              <T variant="heading">This code has expired</T>
              <T variant="small" tone="muted">
                Get a new code, then run the new connect command.
              </T>
            </View>
            <Button label="Get a new code" icon={RefreshCw} size="lg" full onPress={regenerate} />
          </View>
        </Animated.View>
      )}

      {footer && !expired && (
        <Animated.View key="footer" entering={enter.fade} exiting={exit.fade}>
          <Divider />
          <View style={{ paddingHorizontal: 20, paddingVertical: 16 }}>{footer}</View>
        </Animated.View>
      )}
    </Animated.View>
  );
}
