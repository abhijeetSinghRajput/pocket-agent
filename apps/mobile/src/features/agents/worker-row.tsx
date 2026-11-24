import { timeAgo } from '@pocket-agent/core';
import type { WorkerDto, WorkerStatus } from '@pocket-agent/protocol';
import { Bot, ChevronRight, Workflow } from 'lucide-react-native';
import { View } from 'react-native';
import { duration } from '@/features/sessions/badges';
import { alpha, radius, useTheme } from '@/lib/theme';
import { Dot, Press, T, toneColor, type Tone } from '@/ui/core';
import { Roll } from '@/ui/feedback';

const STATUS: Record<WorkerStatus, { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'primary' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  stopped: { label: 'Stopped', tone: 'muted' },
};

/** A worker's status as a pill: the word rolls when it changes; a running one breathes. */
function WorkerBadge({ status }: { status: WorkerStatus }) {
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
 * One background worker: what it was asked to do, what kind it is, which chat it belongs to, how
 * long it has run (or when it ended). Tapping opens the chat it runs in.
 */
export function WorkerRow({ w, onPress }: { w: WorkerDto; onPress: () => void }) {
  const { c } = useTheme();
  const running = w.status === 'running';
  const Icon = w.kind === 'workflow' ? Workflow : Bot;
  const kind = w.kind === 'workflow' ? 'Workflow' : 'Sub-agent';
  const when = running ? duration(w.startedAt, null) : timeAgo(w.finishedAt ?? w.startedAt);
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${kind}: ${w.title}, ${STATUS[w.status].label}, in ${w.projectName}. Open chat`}
      testID="worker-row"
      onPress={onPress}
      scale={0.99}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: running ? alpha(c.primary, 0.13) : c.muted,
        }}
      >
        <Icon size={19} color={running ? c.primary : c.mutedForeground} strokeWidth={2} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <T variant="subheading" numberOfLines={2} style={{ flex: 1, fontSize: 15, lineHeight: 21 }}>
            {w.title}
          </T>
          <T
            variant="caption"
            style={{ fontVariant: ['tabular-nums'], color: running ? c.primary : c.mutedForeground }}
          >
            {when}
          </T>
        </View>
        <T variant="small" tone="muted" numberOfLines={1}>
          {[w.label && w.label !== w.title ? w.label : kind, w.background ? 'background' : null]
            .filter(Boolean)
            .join(' · ')}
        </T>
        {w.summary && !running && (
          <T variant="small" numberOfLines={2} style={{ color: alpha(c.foreground, 0.8) }}>
            {w.summary}
          </T>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <WorkerBadge status={w.status} />
          <T variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {w.projectName} · {w.deviceName}
          </T>
        </View>
      </View>
      <ChevronRight size={18} color={alpha(c.mutedForeground, 0.6)} strokeWidth={2} />
    </Press>
  );
}
