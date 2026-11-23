import type { AgentSessionDto, AgentStatus, ProviderId } from '@pocket-agent/protocol';
import { Bot, Code, EyeOff, SquareTerminal } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Circle, Path, Svg } from 'react-native-svg';
import { alpha, radius, useTheme, type Colors } from '@/lib/theme';
import { Dot, T, type Tone } from '@/ui/core';
import { Roll } from '@/ui/feedback';

/** "<1 min", "12 min", "2 h 5 min", "3 d 2 h": how long a session has been going (or went). */
export function duration(fromIso: string, toIso: string | null, now = Date.now()): string {
  const ms = (toIso ? Date.parse(toIso) : now) - Date.parse(fromIso);
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

type Variant = 'success' | 'neutral' | 'warning' | 'danger' | 'accent';

const STATUS: Record<AgentStatus, { label: string; variant: Variant; pulse?: boolean }> = {
  Starting: { label: 'Starting', variant: 'accent', pulse: true },
  Running: { label: 'Running', variant: 'success', pulse: true },
  WaitingForInput: { label: 'Waiting for input', variant: 'accent' },
  WaitingForPermission: { label: 'Needs permission', variant: 'warning', pulse: true },
  Completed: { label: 'Completed', variant: 'neutral' },
  Failed: { label: 'Failed', variant: 'danger' },
  Stopped: { label: 'Ended', variant: 'neutral' },
  Disconnected: { label: 'PC offline', variant: 'neutral' },
};

const TONE: Record<Variant, Tone> = {
  success: 'success',
  accent: 'primary',
  warning: 'warning',
  danger: 'danger',
  neutral: 'muted',
};

/** The colour of a status dot (neutral is a soft grey). */
function dotColor(c: Colors, variant: Variant): string {
  switch (variant) {
    case 'success':
      return c.success;
    case 'accent':
      return c.primary;
    case 'warning':
      return c.warning;
    case 'danger':
      return c.destructive;
    default:
      return alpha(c.mutedForeground, 0.5);
  }
}

/**
 * Original brand marks of the coding agents Pocket Agent integrates with, one per provider (typed,
 * so adding a provider requires its logo). Paths from simple-icons 16.38.0 (CC0); the logos
 * themselves are trademarks of their owners and are used only to identify the agent.
 */
export const AGENT_LOGOS: Record<ProviderId, { title: string; hex: string; path: string }> = {
  'claude-code': {
    title: 'Claude',
    hex: '#D97757',
    path: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  },
};

export function AgentLogo({ provider, size = 24 }: { provider: ProviderId; size?: number }) {
  const logo = AGENT_LOGOS[provider];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={logo.hex} accessibilityElementsHidden>
      <Path d={logo.path} />
    </Svg>
  );
}

const AVATAR = {
  sm: { box: 36, logo: 20, dot: 12 },
  md: { box: 48, logo: 24, dot: 12 },
  lg: { box: 64, logo: 32, dot: 14 },
};

/** A small ring turning in place: Claude is working. Still (a full ring) when motion is reduced. */
function PresenceSpinner({ color, size }: { color: string; size: number }) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    turn.set(withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1));
    return () => cancelAnimation(turn);
  }, [reduce, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  const stroke = 2;
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  return (
    <Animated.View style={[{ width: size, height: size }, spin]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={alpha(color, 0.25)}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          // A third of the ring, so the turning reads at this size.
          strokeDasharray={reduce ? undefined : [length / 3, length]}
        />
      </Svg>
    </Animated.View>
  );
}

/** Round chat avatar: the agent's own logo, with a presence mark for the live status. */
export function SessionAvatar({
  session,
  size = 'md',
}: {
  session: Pick<AgentSessionDto, 'provider' | 'status'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { c } = useTheme();
  const s = STATUS[session.status];
  const logo = AGENT_LOGOS[session.provider];
  const d = AVATAR[size];
  const working = session.status === 'Running' || session.status === 'Starting';
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: d.box,
        height: d.box,
        borderRadius: d.box / 2,
        backgroundColor: alpha(logo.hex, 0.14),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <AgentLogo provider={session.provider} size={d.logo} />
      {/* The presence mark sits in a ring of the card colour; while Claude works it spins. */}
      <View
        style={{
          position: 'absolute',
          right: working ? -1 : 0,
          bottom: working ? -1 : 0,
          width: working ? d.dot + 2 : d.dot,
          height: working ? d.dot + 2 : d.dot,
          borderRadius: (working ? d.dot + 2 : d.dot) / 2,
          backgroundColor: c.card,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {working ? (
          <PresenceSpinner color={dotColor(c, s.variant)} size={d.dot - 2} />
        ) : (
          <Dot color={dotColor(c, s.variant)} size={d.dot - 4} pulse={s.pulse} />
        )}
      </View>
    </View>
  );
}

/** The session's status as a coloured pill (no dot: the avatar shows presence); the word rolls when it changes. */
export function SessionStatusBadge({ status }: { status: AgentStatus }) {
  const { c } = useTheme();
  const s = STATUS[status];
  const color = dotColor(c, s.variant);
  const text = s.variant === 'neutral' ? c.mutedForeground : color;
  return (
    <View
      testID="session-status"
      accessibilityLabel={s.label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 9,
        height: 24,
        borderRadius: radius.full,
        backgroundColor: s.variant === 'neutral' ? c.muted : alpha(color, 0.14),
        alignSelf: 'flex-start',
      }}
    >
      <Roll text={s.label} variant="captionMedium" color={text} />
    </View>
  );
}

/** Tone of a status, for anything else that wants to colour itself like the badge. */
export function statusTone(status: AgentStatus): Tone {
  return TONE[STATUS[status].variant];
}

/**
 * Whether an observed session reports through Pocket Agent hooks. The PC records this in metadata;
 * capabilities can't be used for it because instructions/approvals are separate PC opt-ins.
 */
export function hooksAreConnected(s: Pick<AgentSessionDto, 'metadata' | 'capabilities'>): boolean {
  return (
    s.metadata?.['hooks'] === 'connected' ||
    s.capabilities.remoteApproval ||
    s.capabilities.instructBetweenTurns
  );
}

/** How the session is connected, in user terms. */
export function sessionKind(s: Pick<AgentSessionDto, 'mode' | 'metadata' | 'capabilities'>): {
  label: string;
  hint: string;
} {
  if (s.mode === 'managed') {
    return { label: 'Managed', hint: 'Started by Pocket Agent on your PC — full remote control.' };
  }
  const where =
    s.metadata?.['entrypoint'] === 'claude-vscode'
      ? 'VS Code'
      : s.metadata?.['entrypoint'] === 'cli'
        ? 'Terminal'
        : 'Claude Code';
  if (!hooksAreConnected(s)) {
    return {
      label: `${where} · status only`,
      hint: 'Started by you. Pocket Agent hooks are not installed, so only the coarse status is visible.',
    };
  }
  return { label: where, hint: 'Started by you. Pocket Agent observes it through Claude Code hooks.' };
}

/** The VS Code mark, as a small glyph (identifies the editor a session runs in). */
function VsCodeIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} accessibilityElementsHidden>
      <Path d="M17.2 1.6 22 3.9c.5.2.8.7.8 1.3v13.6c0 .6-.3 1.1-.8 1.3l-4.8 2.3c-.5.2-1.1.1-1.5-.3L6.5 13.7l-4 3c-.4.3-.9.3-1.2 0l-.9-.8a.9.9 0 0 1 0-1.3L3.9 12 .4 9.4a.9.9 0 0 1 0-1.3l.9-.8c.3-.3.8-.3 1.2 0l4 3 9.2-8.4c.4-.4 1-.5 1.5-.3ZM17.3 6.9 10.4 12l6.9 5.1V6.9Z" />
    </Svg>
  );
}

/**
 * Where the session runs, as an icon (VS Code, terminal, managed by Pocket Agent). The PC reports
 * Claude Code's own `entrypoint` for each session. `withLabel` also spells it out (Session info).
 */
export function SessionKindBadge({
  session,
  withLabel = false,
}: {
  session: Pick<AgentSessionDto, 'mode' | 'metadata' | 'capabilities'>;
  withLabel?: boolean;
}) {
  const { c } = useTheme();
  const k = sessionKind(session);
  const statusOnly = session.mode !== 'managed' && !hooksAreConnected(session);
  const e = session.metadata?.['entrypoint'];
  const iconSize = 14;
  let icon;
  if (session.mode === 'managed') icon = <Bot size={iconSize} color={c.primary} strokeWidth={2} />;
  else if (e === 'claude-vscode') icon = <VsCodeIcon size={iconSize} color={c.toolLink} />;
  else if (e === 'cli')
    icon = <SquareTerminal size={iconSize} color={alpha(c.foreground, 0.8)} strokeWidth={2} />;
  else icon = <Code size={iconSize} color={c.mutedForeground} strokeWidth={2} />;
  return (
    <View
      testID="session-kind"
      accessibilityLabel={`${k.label} — ${k.hint}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        height: 24,
        minWidth: 24,
        paddingHorizontal: withLabel ? 8 : statusOnly ? 6 : 0,
        borderRadius: radius.full,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        backgroundColor: c.card,
        alignSelf: 'flex-start',
      }}
    >
      <View style={{ opacity: statusOnly ? 0.6 : 1 }}>{icon}</View>
      {statusOnly && !withLabel && (
        <EyeOff size={10} color={c.mutedForeground} strokeWidth={2} style={{ marginLeft: -2 }} />
      )}
      {withLabel && (
        <T variant="captionMedium" numberOfLines={1}>
          {k.label}
        </T>
      )}
    </View>
  );
}
