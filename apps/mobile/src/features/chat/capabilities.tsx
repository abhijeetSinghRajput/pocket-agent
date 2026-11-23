import type { AgentSessionDto } from '@pocket-agent/protocol';
import { Check, Clock, X, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { hooksAreConnected } from '@/features/sessions/badges';
import { enter } from '@/lib/motion';
import { alpha, useTheme } from '@/lib/theme';
import { T } from '@/ui/core';

export type CapabilityRow = { label: string; state: 'yes' | 'soon' | 'no'; detail: string };

/**
 * What this session can and cannot do, stated plainly. Never claims a capability the session
 * doesn't have (capabilities are reported by the PC); features this session supports but
 * Pocket Agent hasn't shipped yet say which milestone brings them.
 */
export function capabilityRows(s: AgentSessionDto): CapabilityRow[] {
  const c = s.capabilities;
  const managed = s.mode === 'managed';
  const hooksConnected = !managed && hooksAreConnected(s);
  const hooksWhy =
    s.metadata?.['hooks'] === 'not-connected'
      ? 'This session started before Pocket Agent hooks were installed. Restart it on the PC to connect it.'
      : 'Pocket Agent hooks are not installed on this PC. Run `pocket-agent hooks install`, then restart the session.';

  const instruct: CapabilityRow = managed
    ? {
        label: 'Send instructions',
        state: 'yes',
        detail: 'Any time. Runs right away, or after the current task.',
      }
    : c.instructAnytime
      ? {
          label: 'Send instructions',
          state: 'yes',
          detail:
            'Any time. If Claude is idle, your PC resumes this session and runs it at once; if it is busy, Claude takes it as soon as it can (its next step, or the end of the turn).',
        }
      : c.instructBetweenTurns
        ? {
            label: 'Send instructions',
            state: 'yes',
            detail:
              'While Claude works, it reads your message at its next step (or when the turn ends). To run it at once when Claude is idle, run `pocket-agent instructions wake enable` on the PC.',
          }
        : hooksConnected
          ? {
              label: 'Send instructions',
              state: 'no',
              detail: 'Turned off on this PC. To allow it, run `pocket-agent instructions enable` on the PC.',
            }
          : { label: 'Send instructions', state: 'no', detail: hooksWhy };

  return [
    {
      label: 'Live status',
      state: c.monitor ? 'yes' : 'no',
      detail:
        managed || hooksConnected
          ? 'Status, tool calls and messages stream here.'
          : 'Coarse status only (running / waiting).',
    },
    instruct,
    {
      label: 'Stop / interrupt',
      state: c.interrupt ? 'yes' : 'no',
      detail: c.interrupt
        ? managed
          ? 'Interrupt the current task or end the session.'
          : 'Stop the current turn (Claude stops at its next step), or end the session: that closes its Claude Code process on the PC.'
        : hooksConnected
          ? 'Turned off on this PC. Run `pocket-agent instructions enable` on the PC to allow stopping from here.'
          : 'Not possible until this session reports through hooks.',
    },
    {
      label: 'Approve permissions remotely',
      state: c.remoteApproval ? 'yes' : 'no',
      detail: c.remoteApproval
        ? managed
          ? 'Requests wait for your decision here. Not decided within 10 minutes: denied.'
          : 'Only while Away mode is on for this PC (Devices). Otherwise, or if not decided within 5 minutes, Claude Code asks on the PC.'
        : managed || hooksConnected
          ? 'Turned off on this PC; actions that need approval are answered there (managed: denied). To allow it, run `pocket-agent approvals enable` on the PC.'
          : hooksWhy,
    },
  ];
}

const ICON: Record<CapabilityRow['state'], { Icon: LucideIcon; label: string }> = {
  yes: { Icon: Check, label: 'Available' },
  soon: { Icon: Clock, label: 'Supported, not yet available' },
  no: { Icon: X, label: 'Not available' },
};

/** A hint with `code` spans: the commands to run on the PC are set in mono. */
export function Ticks({ text, variant = 'caption' }: { text: string; variant?: 'caption' | 'small' }) {
  const { c } = useTheme();
  return (
    <T variant={variant} tone="muted">
      {text.split('`').map((part, i) =>
        i % 2 ? (
          <T
            key={i}
            variant="mono"
            style={{
              fontSize: variant === 'caption' ? 11.5 : 12.5,
              backgroundColor: c.muted,
              color: c.foreground,
            }}
          >
            {part}
          </T>
        ) : (
          part
        ),
      )}
    </T>
  );
}

export function CapabilityList({ session }: { session: AgentSessionDto }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 12 }} testID="capabilities" accessibilityRole="list">
      {capabilityRows(session).map((r, i) => {
        const { Icon, label } = ICON[r.state];
        const color = r.state === 'yes' ? c.success : r.state === 'soon' ? c.primary : c.mutedForeground;
        return (
          <Animated.View
            key={r.label}
            entering={enter.rise(i)}
            style={{ flexDirection: 'row', gap: 12 }}
            accessibilityLabel={`${r.label}: ${label}`}
          >
            <View
              style={{
                marginTop: 2,
                width: 20,
                height: 20,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: r.state === 'no' ? c.muted : alpha(color, 0.15),
              }}
            >
              <Icon size={12} color={color} strokeWidth={2.6} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <T variant="smallMedium">{r.label}</T>
              <Ticks text={r.detail} />
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}
