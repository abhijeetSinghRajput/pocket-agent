import { nowDoing, timeAgo } from '@pocket-agent/core';
import type { SubagentInfo, WorkerDto, WorkerStatus } from '@pocket-agent/protocol';
import { ChevronRight } from 'lucide-react-native';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { duration } from '@/features/sessions/badges';
import { enter, exit } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { Dot, Press, T, toneColor, type Tone } from '@/ui/core';
import { Roll } from '@/ui/feedback';

/** Running is green; finished work steps back (muted); a failure stands out. */
const STATUS: Record<WorkerStatus, { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'success' },
  done: { label: 'Done', tone: 'muted' },
  failed: { label: 'Failed', tone: 'danger' },
  stopped: { label: 'Stopped', tone: 'muted' },
};

/** Where a row's status dot sits from its top: on the first line of its title. */
export const ROW_DOT_Y = 23;

/** A worker's status as a pill: the word rolls when it changes; a running one breathes. */
export function WorkerBadge({ status }: { status: WorkerStatus }) {
  const { c } = useTheme();
  const s = STATUS[status];
  const color = toneColor(c, s.tone);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 24,
        paddingHorizontal: 9,
        borderRadius: radius.full,
        backgroundColor: s.tone === 'muted' ? c.muted : alpha(color, 0.14),
      }}
    >
      {status === 'running' && <Dot color={color} pulse />}
      <Roll text={s.label} variant="captionMedium" color={color} />
    </View>
  );
}

/**
 * One agent in the map: a status dot where its branch meets it, its task across the whole width,
 * then what it is and when, how it ended, and its status.
 */
function AgentRow({
  title,
  meta,
  time,
  summary,
  now,
  status,
  accessibilityLabel,
  onPress,
}: {
  title: string;
  meta: string;
  /** What it is doing right now (running agents, read live from the PC). */
  now?: string | null;
  /** How long it has run, or when it ended: beside its status. */
  time: string | null;
  summary?: string | null;
  status: WorkerStatus;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { c } = useTheme();
  const tone = toneColor(c, STATUS[status].tone);
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID="worker-row"
      onPress={onPress}
      scale={0.99}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 12,
        paddingRight: 4,
      }}
    >
      <View style={{ marginTop: ROW_DOT_Y - 12 - 4 }}>
        <Dot
          color={status === 'running' ? tone : alpha(c.mutedForeground, 0.55)}
          size={8}
          pulse={status === 'running'}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T variant="subheading" numberOfLines={2} style={{ fontSize: 15, lineHeight: 21 }}>
          {title}
        </T>
        <T variant="caption" tone="muted" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
          {meta}
        </T>
        {now ? (
          // Each new step rolls in over the last.
          <Animated.View key={now} entering={enter.roll} exiting={exit.fade} testID="agent-now">
            <T
              variant="small"
              numberOfLines={1}
              style={{ fontFamily: fonts.mono, fontSize: 12.5, color: toneColor(c, 'success') }}
            >
              {now}
            </T>
          </Animated.View>
        ) : null}
        {summary ? (
          <T variant="small" numberOfLines={2} style={{ color: alpha(c.foreground, 0.75) }}>
            {summary}
          </T>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <WorkerBadge status={status} />
          {time && (
            <T
              variant="caption"
              style={{
                fontVariant: ['tabular-nums'],
                color: status === 'running' ? toneColor(c, 'success') : c.mutedForeground,
              }}
            >
              {time}
            </T>
          )}
        </View>
      </View>
      <ChevronRight
        size={18}
        color={alpha(c.mutedForeground, 0.6)}
        strokeWidth={2}
        style={{ marginTop: ROW_DOT_Y - 12 - 9 }}
      />
    </Press>
  );
}

const when = (status: WorkerStatus, startedAt: string, endedAt: string | null) =>
  status === 'running' ? `for ${duration(startedAt, null)}` : timeAgo(endedAt ?? startedAt);

/** A background worker of a chat (sub-agent or workflow), as the agent map lists it. */
export function WorkerRow({ w, now, onPress }: { w: WorkerDto; now?: string | null; onPress: () => void }) {
  const kind = w.kind === 'workflow' ? 'Workflow' : 'Sub-agent';
  const meta = [w.label && w.label !== w.title ? w.label : kind, w.background ? 'background' : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <AgentRow
      title={w.title}
      meta={meta}
      time={when(w.status, w.startedAt, w.finishedAt)}
      summary={w.status === 'running' ? null : w.summary}
      now={w.status === 'running' ? now : null}
      status={w.status}
      accessibilityLabel={`${kind}: ${w.title}, ${STATUS[w.status].label}, in ${w.projectName}. ${w.kind === 'subagent' ? 'Open' : 'Open chat'}`}
      onPress={onPress}
    />
  );
}

/** A sub-agent another agent started, as its page lists them. */
export function SubagentRow({ agent: a, onPress }: { agent: SubagentInfo; onPress: () => void }) {
  const status: WorkerStatus = a.finished ? 'done' : 'running';
  const meta = `${a.type} · ${a.toolCalls} tool call${a.toolCalls === 1 ? '' : 's'}`;
  return (
    <AgentRow
      title={a.description || a.type}
      meta={meta}
      time={a.startedAt ? when(status, a.startedAt, a.lastActivityAt) : null}
      now={nowDoing(a)}
      status={status}
      accessibilityLabel={`${a.type}: ${a.description}, ${STATUS[status].label}. Open`}
      onPress={onPress}
    />
  );
}
