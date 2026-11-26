import { DeviceListResponse, type DeviceDto } from '@pocket-agent/protocol';
import { ArrowLeft, Download, KeyRound, LogOut, Monitor, Plus, Zap } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Image, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConnectStatus, ConnectSteps, type ConnectMode } from '@/features/devices/connect-steps';
import { usePairing } from '@/features/devices/use-pairing';
import { apiRequest } from '@/lib/api';
import { useAuth, useUser } from '@/lib/auth';
import { ease, enter, exit } from '@/lib/motion';
import { alpha, radius, useTheme } from '@/lib/theme';
import { playSound } from '@/lib/sound';
import { Avatar, Button, buzz, Divider, IconTile, Press, Spinner, T } from '@/ui/core';
import { SuccessTick } from '@/ui/feedback';
import { Sheet } from '@/ui/sheet';

const STEPS = [
  { icon: Download, title: 'Install Pocket Agent', text: 'Run a single command on your PC.' },
  {
    icon: KeyRound,
    title: 'Pair your device',
    text: 'Scan the QR code it shows, or type a 6-character code.',
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

/** How long the tick shows before a PC that already has workspaces goes straight into the app. */
const AUTO_OPEN_MS = 1600;
/** How long to wait for the PC's settings (its workspaces) after it comes online. */
const SETTINGS_WAIT_MS = 2000;

/**
 * Whether the new PC already has workspaces (a PC paired again keeps its list). Its settings
 * arrive just after it comes online, so look a few times before deciding it has none.
 */
function useHasWorkspaces(device: DeviceDto): boolean | null {
  const [has, setHas] = useState<boolean | null>(device.projects.length > 0 ? true : null);
  useEffect(() => {
    if (has !== null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const look = async () => {
      try {
        const { devices } = await apiRequest('/devices', DeviceListResponse);
        if (!alive) return;
        if ((devices.find((d) => d.id === device.id)?.projects.length ?? 0) > 0) return setHas(true);
      } catch {
        /* decided by the deadline below */
      }
      if (!alive) return;
      if (Date.now() - started >= SETTINGS_WAIT_MS) setHas(false);
      else timer = setTimeout(() => void look(), 700);
    };
    void look();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [device.id, has]);
  return has;
}

/**
 * The PC is online: a big tick that draws itself. A PC that already has workspaces then opens the
 * app by itself; a new one offers to set up its first workspace.
 */
function Connected({ device, onDone }: { device: DeviceDto; onDone: () => void }) {
  const hasWorkspaces = useHasWorkspaces(device);
  const [mountedAt] = useState(() => Date.now());
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);
  useEffect(() => {
    buzz(true);
    playSound('landed');
  }, []);
  useEffect(() => {
    if (!hasWorkspaces) return;
    const id = setTimeout(() => doneRef.current(), Math.max(0, AUTO_OPEN_MS - (Date.now() - mountedAt)));
    return () => clearTimeout(id);
  }, [hasWorkspaces, mountedAt]);
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
      <View style={{ marginTop: 40, width: '100%', maxWidth: 384, minHeight: 52, justifyContent: 'center' }}>
        {hasWorkspaces === false && (
          <Animated.View entering={riseAfter(0)}>
            <Button label="Set up your workspace" size="lg" full onPress={onDone} testID="onboarding-done" />
          </Animated.View>
        )}
        {hasWorkspaces === true && (
          <Animated.View entering={riseAfter(560)}>
            <T variant="small" tone="muted" center accessibilityLiveRegion="polite">
              Opening your workspaces…
            </T>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

/** The connect page's top bar: back, the app's name, and the account. */
function ConnectHeader({ onBack }: { onBack: () => void }) {
  const user = useUser();
  const { c } = useTheme();
  const [account, setAccount] = useState(false);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 8,
      }}
    >
      <Press
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        scale={0.92}
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: c.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ArrowLeft size={20} color={c.foreground} strokeWidth={2} />
      </Press>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <Image
          source={require('@/assets/images/logo.png')}
          style={{ width: 32, height: 32, borderRadius: 8 }}
          accessibilityIgnoresInvertColors
        />
        <T variant="subheading" numberOfLines={1}>
          Pocket Agent
        </T>
      </View>
      <Press
        accessibilityRole="button"
        accessibilityLabel="Account"
        testID="onboarding-account"
        onPress={() => setAccount(true)}
        scale={0.92}
        style={{ borderRadius: 22 }}
      >
        <Avatar name={user.name} url={user.avatarUrl} size={44} />
      </Press>
      <AccountSheet open={account} onClose={() => setAccount(false)} />
    </View>
  );
}

/**
 * The first screen for an account without a PC; it can't be skipped (nothing works without one),
 * the account sheet still offers sign out. Page 1 explains and has the one button; page 2 connects
 * the PC (scan its QR code or type a code) and follows it live; once it is online, the success screen.
 */
export function Onboarding({ knownDeviceIds, onDone }: { knownDeviceIds: string[]; onDone: () => void }) {
  const user = useUser();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const firstName = user.name.trim().split(/\s+/)[0];
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<ConnectMode>('scan');
  const { step, now, regenerate } = usePairing({ active: started, knownDeviceIds });
  const connected = started && step.kind === 'paired' && step.device.status === 'Online';

  // Android back on the connect page goes back to the welcome page instead of closing the app.
  useEffect(() => {
    if (!started || connected) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setStarted(false);
      return true;
    });
    return () => sub.remove();
  }, [started, connected]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
      {connected ? (
        <Animated.View key="connected" entering={enter.fade} exiting={exit.fade} style={{ flex: 1 }}>
          <Connected device={step.device} onDone={onDone} />
        </Animated.View>
      ) : !started ? (
        <Animated.View key="welcome" entering={enter.fade} exiting={exit.fade} style={{ flex: 1 }}>
          <Header />
          <ScrollView
            contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
            showsVerticalScrollIndicator={false}
          >
            <Welcome firstName={firstName} onStart={() => setStarted(true)} />
          </ScrollView>
        </Animated.View>
      ) : (
        <Animated.View key="connect" entering={enter.fade} exiting={exit.fade} style={{ flex: 1 }}>
          <ConnectHeader onBack={() => setStarted(false)} />
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View entering={enter.rise(0)}>
              <T variant="display" accessibilityRole="header">
                Connect your PC
              </T>
            </Animated.View>
            <Animated.View entering={enter.rise(1)} style={{ marginTop: 20 }}>
              <ConnectSteps
                step={step}
                now={now}
                regenerate={() => void regenerate()}
                mode={mode}
                onModeChange={setMode}
              />
            </Animated.View>
          </ScrollView>
          <Animated.View
            entering={enter.rise(2)}
            style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: insets.bottom + 12 }}
          >
            <ConnectStatus step={step} mode={mode} />
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}
