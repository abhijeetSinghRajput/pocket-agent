import { buildChat } from '@pocket-agent/core';
import { useMemo } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatMessages } from '@/features/chat/messages';
import { useSubagent } from '@/lib/data';
import { useTheme } from '@/lib/theme';
import { T } from '@/ui/core';
import { Notice, Skeleton } from '@/ui/feedback';
import { NavBar } from '@/ui/screen';

/**
 * A sub-agent's whole transcript, drawn like a chat: its prompt, what it said, every tool call with
 * its output. The same data as the agent's page (one request for both).
 */
export function AgentTranscriptScreen({ sessionId, toolUseId }: { sessionId: string; toolUseId: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { state } = useSubagent(sessionId, toolUseId);
  const data = state.data;
  const items = useMemo(() => (data ? buildChat(data.events, []) : []), [data]);
  const running = data ? !data.agent.finished : false;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <NavBar title="Transcript" subtitle={data?.agent.description} />
      {state.status === 'loading' && (
        <View accessibilityState={{ busy: true }} style={{ padding: 16, gap: 12 }}>
          <Skeleton height={90} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </View>
      )}
      {state.error && (
        <View style={{ padding: 16 }}>
          <Notice>{state.error}</Notice>
        </View>
      )}
      {data && (
        <ChatMessages
          items={items}
          typing={running ? 'working' : null}
          bottomInset={insets.bottom}
          header={
            data.truncated ? (
              <T variant="caption" tone="muted" center>
                The first steps are left out: the transcript is longer than one answer from your PC.
              </T>
            ) : undefined
          }
        />
      )}
    </View>
  );
}
