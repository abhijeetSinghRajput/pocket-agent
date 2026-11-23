import { formatDate, timeAgo } from '@pocket-agent/core';
import type { AgentSessionDto } from '@pocket-agent/protocol';
import { FolderOpen, Laptop } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { CapabilityList } from '@/features/chat/capabilities';
import { SessionControls } from '@/features/chat/composer';
import {
  duration,
  SessionAvatar,
  SessionKindBadge,
  SessionStatusBadge,
  sessionKind,
} from '@/features/sessions/badges';
import { enter } from '@/lib/motion';
import { useTheme } from '@/lib/theme';
import { Divider, T } from '@/ui/core';
import { Sheet } from '@/ui/sheet';

function Section({ children, index }: { children: ReactNode; index: number }) {
  return (
    <Animated.View entering={enter.rise(index)} style={{ paddingVertical: 16, gap: 12 }}>
      {children}
    </Animated.View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <T variant="small" tone="muted">
        {label}
      </T>
      <T variant="small" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </T>
    </View>
  );
}

/** Details of a session and what you can do in it; rises from the bottom over the chat. */
export function SessionInfo({
  session: s,
  open,
  onClose,
  onChange,
}: {
  session: AgentSessionDto;
  open: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const { c } = useTheme();
  const { height } = useWindowDimensions();
  return (
    <Sheet open={open} onClose={onClose} title="Session info">
      <ScrollView
        testID="session-info"
        accessibilityLabel="Details and what you can do in this session."
        style={{ maxHeight: height * 0.72 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 8 }}
      >
        <Section index={0}>
          <View style={{ alignItems: 'center', gap: 8 }}>
            <SessionAvatar session={s} size="lg" />
            <T variant="heading" center style={{ marginTop: 4 }}>
              {s.projectName}
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
              <SessionStatusBadge status={s.status} />
              <SessionKindBadge session={s} withLabel />
            </View>
            {s.currentTask && (
              <T variant="small" tone="muted" center style={{ marginTop: 4 }}>
                {s.currentTask}
              </T>
            )}
          </View>
        </Section>
        <Divider />
        <Section index={1}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
            <FolderOpen size={16} color={c.mutedForeground} strokeWidth={2} style={{ marginTop: 2 }} />
            <T
              variant="mono"
              accessibilityLabel={`Project path ${s.projectPath}`}
              style={{ flex: 1, fontSize: 12.5, lineHeight: 18 }}
            >
              {s.projectPath}
            </T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Laptop size={16} color={c.mutedForeground} strokeWidth={2} />
            <T variant="small" accessibilityLabel={`Device ${s.deviceName}`} style={{ flex: 1 }}>
              {s.deviceName}
            </T>
          </View>
          <Fact label="Started" value={`${formatDate(s.startedAt)} · ${duration(s.startedAt, s.endedAt)}`} />
          <Fact label="Last activity" value={timeAgo(s.lastActivityAt)} />
        </Section>
        <Divider />
        <Section index={2}>
          <View style={{ gap: 4 }}>
            <T variant="smallMedium" accessibilityRole="header">
              What you can do here
            </T>
            <T variant="caption" tone="muted">
              {sessionKind(s).hint}
            </T>
          </View>
          <CapabilityList session={s} />
        </Section>
        {s.capabilities.interrupt && !s.endedAt && (
          <>
            <Divider />
            <Section index={3}>
              <SessionControls session={s} onDone={onChange} />
            </Section>
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}
