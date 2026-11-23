import type { DeviceDto } from '@pocket-agent/protocol';
import { ArrowLeft, Download, KeyRound, LogOut, Monitor, Plus, Zap } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConnectSteps } from '@/features/devices/connect-steps';
import { usePairing } from '@/features/devices/use-pairing';
import { useAuth, useUser } from '@/lib/auth';
import { ease, enter, exit } from '@/lib/motion';
import { alpha, radius, useTheme } from '@/lib/theme';
import { Avatar, Button, buzz, Divider, IconTile, Press, Spinner, T } from '@/ui/core';
import { SuccessTick } from '@/ui/feedback';
import { Sheet } from '@/ui/sheet';

const STEPS = [
  { icon: Download, title: 'Install Pocket Agent', text: 'Run a single command on your Windows PC.' },
  {
    icon: KeyRound,
    title: 'Pair your device',
    text: 'Connect it with a one-time code from this app.',
  },
  { icon: Zap, title: 'You’re ready!', text: 'Follow and steer your Claude sessions from anywhere.' },
];

/** Account sheet: who is signed in and the one way out of this screen. */
function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useUser();
  const { logout } = useAuth();
  const { c } = useTheme();
  const [pending, setPending] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} dismissable={!pending}>
      <View style={{ paddingBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
          <Avatar name={user.name} url={user.avatarUrl} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="bodyMedium" numberOfLines={1}>
              {user.name}
            </T>
            <T variant="small" tone="muted" numberOfLines={1}>
              {user.email}
            </T>
          </View>
        </View>
        <Divider />
        <Press
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          testID="onboarding-sign-out"
          disabled={pending}
          onPress={async () => {
            setPending(true);
            await logout();
          }}
          scale={0.98}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            height: 52,
            marginTop: 8,
            paddingHorizontal: 12,
            borderRadius: radius.lg,
          }}
        >
          {pending ? <Spinner tone="danger" /> : <LogOut size={18} color={c.destructive} strokeWidth={2} />}
          <T variant="bodyMedium" style={{ color: c.destructive }}>
            Sign out
          </T>
        </Press>
      </View>
    </Sheet>
  );
}

function Header() {
  const user = useUser();
  const [account, setAccount] = useState(false);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
        <Image
          source={require('@/assets/images/logo.png')}
          style={{ width: 44, height: 44, borderRadius: 11 }}
          accessibilityIgnoresInvertColors
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="heading">Pocket Agent</T>
          <T variant="small" tone="muted" numberOfLines={1}>
            Access your agent from anywhere.
          </T>
        </View>
      </View>
      <Press
        accessibilityRole="button"
        accessibilityLabel="Account"
        testID="onboarding-account"
        onPress={() => setAccount(true)}
        scale={0.92}
        style={{ borderRadius: 20 }}
      >
        <Avatar name={user.name} url={user.avatarUrl} size={40} />
      </Press>
      <AccountSheet open={account} onClose={() => setAccount(false)} />
    </View>
  );
}

/** Page 1: who this is for, the one button, and how it works. */
function Welcome({ firstName, onStart }: { firstName: string | undefined; onStart: () => void }) {
  const { c, dark } = useTheme();
  return (
    <View style={{ paddingHorizontal: 20, gap: 0 }}>
      <Animated.View entering={enter.rise(0)}>
        <Divider />
        <View style={{ paddingTop: 32, gap: 8 }}>
          <T variant="overline" tone="primary">
            WELCOME ABOARD
          </T>
          <T variant="display" accessibilityRole="header">
            {firstName ? `Hey, ${firstName}` : 'Hey there'} 👋
          </T>
          <T variant="title" style={{ marginTop: -4 }}>
            Let’s connect your PC.
          </T>
          <T variant="body" tone="muted" style={{ marginTop: 4 }}>
            Set up Pocket Agent once and follow and steer Claude on your computer right from your phone.
          </T>
        </View>
      </Animated.View>

      <Animated.View
        entering={enter.rise(1)}
        style={{
          marginTop: 32,
          backgroundColor: c.card,
          borderRadius: radius.xxl,
          borderWidth: dark ? 0 : StyleSheet.hairlineWidth,
          borderColor: c.border,
          padding: 20,
        }}
      >
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
        >
          <T variant="heading" accessibilityRole="header">
            Your devices
          </T>
          <View
            testID="onboarding-status"
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: radius.full,
              backgroundColor: alpha(c.primary, 0.12),
            }}
          >
            <T variant="captionMedium" tone="primary">
              Not connected
            </T>
          </View>
        </View>
        <View style={{ alignItems: 'center', paddingTop: 24 }}>
          <IconTile icon={Monitor} size={64} />
          <T variant="heading" center style={{ marginTop: 16 }}>
            No PC connected yet
          </T>
          <T variant="small" tone="muted" center style={{ marginTop: 4 }}>
            Your connected computers will appear here.
          </T>
          <Button
            label="Connect your PC"
            icon={Plus}
            size="lg"
            full
            onPress={onStart}
            style={{ marginTop: 24 }}
            testID="onboarding-connect"
          />
          <T variant="caption" tone="primary" center style={{ marginTop: 12 }}>
            Takes about 2 minutes · One-time setup
          </T>
        </View>
      </Animated.View>

      <Animated.View entering={enter.rise(2)} style={{ marginTop: 40 }}>
        <T variant="heading" accessibilityRole="header">
          How it works
        </T>
        <View style={{ marginTop: 20, gap: 20 }}>
          {STEPS.map(({ icon, title, text }, i) => (
            <Animated.View
              key={title}
              entering={enter.rise(3 + i)}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}
            >
              <IconTile icon={icon} />
              <View style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                <T variant="subheading">
                  {String(i + 1).padStart(2, '0')}. {title}
                </T>
                <T variant="small" tone="muted" style={{ marginTop: 2 }}>
                  {text}
                </T>
              </View>
            </Animated.View>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

/** Text rising in a little after the tick, as on the web (420 / 480 / 560 ms). */
const riseAfter = (delay: number) =>
  FadeInDown.duration(380)
    .easing(ease.out)
    .delay(delay)
    .withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] });

/** The PC is online: a big tick that draws itself, then the way into the app. */
function Connected({ device, onDone }: { device: DeviceDto; onDone: () => void }) {
  useEffect(() => {
    buzz(true);
  }, []);
  return (
    <View
      testID="onboarding-connected"
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}
    >
      <SuccessTick size={128} />
      <Animated.View entering={riseAfter(420)}>
        <T variant="display" center accessibilityRole="header" style={{ marginTop: 36 }}>
          Your PC is connected!
        </T>
      </Animated.View>
      <Animated.View entering={riseAfter(480)} style={{ maxWidth: 320 }}>
        <T variant="body" tone="muted" center style={{ marginTop: 12 }}>
          <T variant="bodyMedium">{device.name}</T> is online. Pocket Agent runs in the background on it.
        </T>
      </Animated.View>
      <Animated.View entering={riseAfter(560)} style={{ marginTop: 40, width: '100%', maxWidth: 384 }}>
        <Button label="Set up your workspace" size="lg" full onPress={onDone} testID="onboarding-done" />
      </Animated.View>
    </View>
  );
}

/**
 * The first screen for an account without a PC; it can't be skipped (nothing works without one),
 * the account sheet still offers sign out. Page 1 explains and has the one button; page 2 has the
 * two commands and follows the PC live; once the PC is online, the success screen.
 */
export function Onboarding({ knownDeviceIds, onDone }: { knownDeviceIds: string[]; onDone: () => void }) {
  const user = useUser();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const firstName = user.name.trim().split(/\s+/)[0];
  const [started, setStarted] = useState(false);
  const { step, now, regenerate } = usePairing({ active: started, knownDeviceIds });
  const paired = started && step.kind === 'paired';
  const connected = paired && step.device.status === 'Online';

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
      {connected ? (
        <Animated.View key="connected" entering={enter.fade} exiting={exit.fade} style={{ flex: 1 }}>
          <Connected device={step.device} onDone={onDone} />
        </Animated.View>
      ) : (
        <Animated.View key="pages" exiting={exit.fade} style={{ flex: 1 }}>
          <Header />
          <ScrollView
            contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {!started ? (
              <Animated.View key="welcome" entering={enter.fade} exiting={exit.fade}>
                <Welcome firstName={firstName} onStart={() => setStarted(true)} />
              </Animated.View>
            ) : (
              <Animated.View
                key="commands"
                entering={enter.rise(0)}
                exiting={exit.fade}
                style={{ paddingHorizontal: 20 }}
              >
                <Divider />
                <View style={{ paddingTop: 20 }}>
                  {!paired && (
                    <Animated.View exiting={exit.fade} style={{ alignSelf: 'flex-start' }}>
                      <Press
                        accessibilityRole="button"
                        accessibilityLabel="Back"
                        onPress={() => setStarted(false)}
                        scale={0.94}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          height: 36,
                          marginLeft: -8,
                          paddingHorizontal: 8,
                          borderRadius: radius.md,
                        }}
                      >
                        <ArrowLeft size={16} color={c.mutedForeground} strokeWidth={2} />
                        <T variant="small" tone="muted">
                          Back
                        </T>
                      </Press>
                    </Animated.View>
                  )}
                  <T variant="title" accessibilityRole="header" style={{ marginTop: 12 }}>
                    Connect your PC
                  </T>
                  <T variant="body" tone="muted" style={{ marginTop: 6 }}>
                    Run these in PowerShell on your Windows PC. This page updates by itself.
                  </T>
                  <View style={{ marginTop: 24 }}>
                    <ConnectSteps
                      step={step}
                      now={now}
                      regenerate={() => void regenerate()}
                      footer={
                        <View
                          accessibilityLiveRegion="polite"
                          testID="onboarding-status"
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                        >
                          <Spinner />
                          <Animated.View
                            key={paired ? 'found' : 'waiting'}
                            entering={enter.fade}
                            style={{ flex: 1 }}
                          >
                            {paired ? (
                              <T variant="small">
                                <T variant="smallMedium">{step.device.name}</T> found. Connecting…
                              </T>
                            ) : (
                              <T variant="small" tone="muted">
                                Waiting for your PC…
                              </T>
                            )}
                          </Animated.View>
                        </View>
                      }
                    />
                  </View>
                </View>
              </Animated.View>
            )}
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}
