import { PAIRING_CODE_TTL_MS } from '@pocket-agent/protocol';
import { mmss } from '@pocket-agent/core';
import { Check, Clock, Hash, QrCode, RefreshCw, ScanLine, Share2 } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { PairingStep } from '@/features/devices/use-pairing';
import { PairScanner } from '@/features/devices/pair-scanner';
import { AGENT_NPM_PACKAGE, connectCommand, installCommand } from '@/lib/api';
import { dur, ease, enter, exit, layout } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { Button, Divider, Dot, Press, T, tap } from '@/ui/core';
import { CopyButton } from '@/ui/copy';
import { Notice, Skeleton } from '@/ui/feedback';
import { Segmented } from '@/ui/form';

/** How the PC gets paired: its QR code scanned by this phone, or a code typed on the PC. */
export type ConnectMode = 'scan' | 'code';

const MODES = [
  { value: 'scan' as const, label: 'Scan QR', icon: ScanLine },
  { value: 'code' as const, label: 'Use code', icon: Hash },
];

/** The step's number in a small circle; green with a tick once done. */
function StepNumber({ n, done }: { n: number; done: boolean }) {
  const { c } = useTheme();
  const on = useSharedValue(done ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(done ? 1 : 0, { duration: dur.enter, easing: ease.out }));
  }, [done, on]);
  const fill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [c.muted, c.success]),
  }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
        fill,
      ]}
    >
      {done ? (
        <Animated.View key="done" entering={enter.pop} exiting={exit.fade}>
          <Check size={15} color="#ffffff" strokeWidth={3} />
        </Animated.View>
      ) : (
        <Animated.View key="n" entering={enter.pop} exiting={exit.fade}>
          <T variant="smallMedium" style={{ fontFamily: fonts.semibold }}>
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
  done = false,
  aside,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  /** Small note at the end of the title row (e.g. "Node 24+"). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={{ padding: 16, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <StepNumber n={n} done={done} />
        <T
          variant="subheading"
          accessibilityRole="header"
          accessibilityLabel={`Step ${n}${done ? ' (done)' : ''}: ${title}`}
          style={{ flex: 1 }}
          numberOfLines={1}
        >
          {title}
        </T>
        {aside}
      </View>
      {children}
    </View>
  );
}

function Chip({ label }: { label: string }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 9,
        height: 24,
        borderRadius: radius.full,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: c.border,
        justifyContent: 'center',
      }}
    >
      <T variant="captionMedium" tone="muted">
        {label}
      </T>
    </View>
  );
}

/**
 * A command to run, drawn as a small terminal: a "Terminal" bar with Copy, then the command.
 * `accent` is the word shown in the brand colour. An expired command is grey and its code struck out.
 */
function TerminalBox({
  command,
  accent,
  expired,
  testID,
}: {
  command: string;
  accent: string;
  expired?: boolean;
  testID?: string;
}) {
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
          height: 40,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: 14,
          paddingRight: 6,
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
      <View style={{ paddingHorizontal: 14, paddingBottom: 14, paddingTop: 2 }}>
        <T variant="mono" selectable={!expired} testID={testID}>
          <T
            variant="mono"
            style={{ fontFamily: fonts.monoMedium, color: expired ? c.mutedForeground : c.foreground }}
          >
            {program}
          </T>{' '}
          {rest.map((word, i) => (
            <T
              key={i}
              variant="mono"
              style={
                word === accent
                  ? expired
                    ? { color: c.mutedForeground, textDecorationLine: 'line-through' }
                    : { fontFamily: fonts.monoMedium, color: c.primary }
                  : { color: c.mutedForeground }
              }
            >
              {word}
              {i < rest.length - 1 ? ' ' : ''}
            </T>
          ))}
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

/** A viewfinder (brackets in the corners) around a QR glyph: tapping it opens the scanner too. */
function Viewfinder({ onPress }: { onPress: () => void }) {
  const { c, dark } = useTheme();
  const corner = (v: 'top' | 'bottom', h: 'left' | 'right') => ({
    position: 'absolute' as const,
    width: 22,
    height: 22,
    [v]: 0,
    [h]: 0,
    borderColor: c.primary,
    [`border${v === 'top' ? 'Top' : 'Bottom'}Width`]: 3,
    [`border${h === 'left' ? 'Left' : 'Right'}Width`]: 3,
    [`border${v === 'top' ? 'Top' : 'Bottom'}${h === 'left' ? 'Left' : 'Right'}Radius`]: 10,
  });
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel="Open scanner"
      onPress={onPress}
      scale={0.98}
      style={{
        height: 128,
        borderRadius: radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        backgroundColor: dark ? c.code : alpha(c.background, 0.6),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: 88, height: 88, alignItems: 'center', justifyContent: 'center' }}>
        <View style={corner('top', 'left')} />
        <View style={corner('top', 'right')} />
        <View style={corner('bottom', 'left')} />
        <View style={corner('bottom', 'right')} />
        <QrCode size={44} color={c.foreground} strokeWidth={1.8} />
      </View>
    </Press>
  );
}

/** The commands as one text, for the share sheet (typed on the PC while the phone is in hand). */
function shareCommands(code: string | null) {
  tap();
  const message = code
    ? `Connect your PC to Pocket Agent (run in a terminal):\n\n${installCommand()}\n${connectCommand(code)}\n\nThe code is single use and expires in ${PAIRING_CODE_TTL_MS / 60_000} minutes.`
    : `Connect your PC to Pocket Agent (run in a terminal):\n\n${installCommand()}\n${connectCommand()}\n\nThen scan the QR code it shows with the Pocket Agent app.`;
  void Share.share({ message, title: 'Connect your PC to Pocket Agent' }).catch(() => undefined);
}

/**
 * How to pair a PC, either way: "Scan QR" (run connect, scan the PC's QR code with this phone) or
 * "Use code" (run connect with a short code, counting down; once it expires it is struck out and a
 * button gets a new one). Shared by the onboarding screen and the Add device sheet.
 */
export function ConnectSteps({
  step,
  now,
  regenerate,
  mode,
  onModeChange,
}: {
  step: PairingStep;
  now: number;
  regenerate: () => void;
  mode: ConnectMode;
  onModeChange: (mode: ConnectMode) => void;
}) {
  const { c, dark } = useTheme();
  const [scanning, setScanning] = useState(false);
  const paired = step.kind === 'paired';
  const expired = step.kind === 'expired';
  const left = step.kind === 'code' ? Math.max(0, Math.min(step.expiresAt - now, PAIRING_CODE_TTL_MS)) : 0;
  const code = step.kind === 'code' || step.kind === 'expired' ? step.code : '';

  return (
    <View style={{ gap: 16 }}>
      <Segmented
        options={MODES}
        value={mode}
        onChange={onModeChange}
        large
        strong
        label="How to connect"
        testID="connect-mode"
      />
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
        <Step n={1} title="Install Pocket Agent" done={paired} aside={<Chip label="Node 24+" />}>
          <TerminalBox command={installCommand()} accent={AGENT_NPM_PACKAGE} testID="install-command" />
        </Step>
        <Divider />

        {paired ? (
          <Animated.View key="paired" entering={enter.fade}>
            <Step n={2} title="Connect this PC" done>
              <T variant="small">
                <T variant="smallMedium">{step.device.name}</T> is paired. Finishing setup on the PC…
              </T>
            </Step>
          </Animated.View>
        ) : mode === 'scan' ? (
          <Animated.View key="scan" entering={enter.fade} exiting={exit.fade}>
            <Step n={2} title="Run on your PC">
              <TerminalBox command={connectCommand()} accent="connect" testID="scan-command" />
            </Step>
            <Divider />
            <Step n={3} title="Scan with this phone">
              <Viewfinder onPress={() => setScanning(true)} />
              <Button
                label="Open scanner"
                icon={ScanLine}
                size="lg"
                full
                onPress={() => setScanning(true)}
                testID="scan-pc"
              />
            </Step>
          </Animated.View>
        ) : (
          <Animated.View key="code" entering={enter.fade} exiting={exit.fade}>
            <Step n={2} title="Your pairing code">
              {step.kind === 'creating' && <Skeleton height={86} round={radius.lg} />}
              {step.kind === 'error' && (
                <View style={{ gap: 12 }}>
                  <Notice>{step.message}</Notice>
                  <Button
                    label="Try again"
                    icon={RefreshCw}
                    variant="outline"
                    size="sm"
                    onPress={regenerate}
                  />
                </View>
              )}
              {(step.kind === 'code' || expired) && (
                <View style={{ gap: 14 }}>
                  <TerminalBox
                    command={connectCommand(code)}
                    accent={code}
                    expired={expired}
                    testID="pairing-command"
                  />
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      minHeight: 32,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                      <Clock size={15} color={c.mutedForeground} strokeWidth={2} />
                      <T variant="small" tone="muted">
                        Single use
                      </T>
                    </View>
                    {expired ? (
                      <Animated.View key="new" entering={enter.pop}>
                        <Button
                          label="New code"
                          icon={RefreshCw}
                          size="sm"
                          onPress={regenerate}
                          testID="new-code"
                        />
                      </Animated.View>
                    ) : (
                      <T
                        variant="small"
                        tone="muted"
                        accessibilityLiveRegion="polite"
                        style={{ fontVariant: ['tabular-nums'] }}
                      >
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
                  {!expired && <CountdownBar fraction={left / PAIRING_CODE_TTL_MS} />}
                </View>
              )}
            </Step>
          </Animated.View>
        )}
      </Animated.View>
      {scanning && <PairScanner onClose={() => setScanning(false)} />}
    </View>
  );
}

/**
 * The live status under the steps: waiting (a pulsing dot) or the PC found, and Share for sending
 * the commands to the PC.
 */
export function ConnectStatus({ step, mode }: { step: PairingStep; mode: ConnectMode }) {
  const { c, dark } = useTheme();
  const paired = step.kind === 'paired';
  const code = mode === 'code' && step.kind === 'code' ? step.code : null;
  return (
    <View
      testID="onboarding-status"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingLeft: 16,
        paddingRight: 8,
        height: 60,
        borderRadius: radius.xl,
        backgroundColor: c.card,
        borderWidth: dark ? 0 : StyleSheet.hairlineWidth,
        borderColor: c.border,
      }}
    >
      <Dot color={paired ? c.success : c.primary} pulse={!paired} />
      <Animated.View
        key={paired ? 'found' : 'waiting'}
        entering={enter.fade}
        accessibilityLiveRegion="polite"
        style={{ flex: 1, minWidth: 0 }}
      >
        {paired ? (
          <T variant="small" numberOfLines={1}>
            <T variant="smallMedium">{step.device.name}</T> found. Connecting…
          </T>
        ) : (
          <T variant="small" tone="muted" numberOfLines={1}>
            Waiting for your PC…
          </T>
        )}
      </Animated.View>
      {!paired && (
        <Button
          label="Share"
          icon={Share2}
          variant="secondary"
          size="sm"
          onPress={() => shareCommands(code)}
          testID="share-commands"
        />
      )}
    </View>
  );
}
