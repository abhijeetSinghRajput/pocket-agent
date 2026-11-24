import type { WorkerDto } from '@pocket-agent/protocol';
import { useRouter } from 'expo-router';
import { MessagesSquare } from 'lucide-react-native';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { enter, layout } from '@/lib/motion';
import { alpha, useTheme } from '@/lib/theme';
import { Press, T } from '@/ui/core';
import { useOpenAgent } from './agent-detail';
import { TreeChildren } from './tree';
import { WorkerRow } from './worker-row';

interface Chat {
  sessionId: string;
  projectName: string;
  deviceName: string;
  workers: WorkerDto[];
  running: number;
}

/** Workers grouped by the chat that started them: chats with something running first. */
function byChat(workers: readonly WorkerDto[]): Chat[] {
  const chats = new Map<string, Chat>();
  for (const w of workers) {
    const chat = chats.get(w.sessionId) ?? {
      sessionId: w.sessionId,
      projectName: w.projectName,
      deviceName: w.deviceName,
      workers: [],
      running: 0,
    };
    chat.workers.push(w);
    if (w.status === 'running') chat.running++;
    chats.set(w.sessionId, chat);
  }
  const latest = (c: Chat) => Math.max(...c.workers.map((w) => Date.parse(w.startedAt)));
  for (const c of chats.values())
    c.workers.sort(
      (a, b) =>
        Number(b.status === 'running') - Number(a.status === 'running') ||
        Date.parse(b.startedAt) - Date.parse(a.startedAt),
    );
  return [...chats.values()].sort(
    (a, b) => Number(b.running > 0) - Number(a.running > 0) || latest(b) - latest(a),
  );
}

/** A chat at the root of its branch: where the agents below were started. Tap to open it. */
function ChatNode({ chat, onPress }: { chat: Chat; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`Chat ${chat.projectName}, ${chat.workers.length} agents. Open chat`}
      onPress={onPress}
      scale={0.99}
      testID="agent-map-chat"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 9,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: chat.running ? alpha(c.primary, 0.13) : c.muted,
        }}
      >
        <MessagesSquare size={15} color={chat.running ? c.primary : c.mutedForeground} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="subheading" numberOfLines={1} style={{ fontSize: 15 }}>
          {chat.projectName}
        </T>
        <T variant="caption" tone="muted" numberOfLines={1}>
          {chat.deviceName} · {chat.workers.length} agent{chat.workers.length === 1 ? '' : 's'}
          {chat.running ? ` · ${chat.running} running` : ''}
        </T>
      </View>
    </Press>
  );
}

/** One chat's branch: the chat, then its agents. */
function ChatBranch({ chat, index }: { chat: Chat; index: number }) {
  const router = useRouter();
  const openAgent = useOpenAgent(chat.sessionId);
  return (
    <Animated.View entering={enter.rise(index)} layout={layout}>
      <ChatNode
        chat={chat}
        onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.sessionId } })}
      />
      <TreeChildren
        items={chat.workers}
        keyOf={(w) => w.id}
        render={(w) => (
          <WorkerRow
            w={w}
            // A sub-agent opens its own page (prompt, tool calls, transcript); a workflow its chat.
            onPress={() =>
              w.kind === 'subagent'
                ? openAgent(w.id)
                : router.push({ pathname: '/chat/[id]', params: { id: w.sessionId } })
            }
          />
        )}
      />
    </Animated.View>
  );
}

/**
 * The agent map: every chat that started sub-agents or workflows (running now, or finished in the
 * last day), each with its agents branching off it like a file tree.
 */
export function AgentMap({ workers }: { workers: readonly WorkerDto[] }) {
  const chats = byChat(workers);
  if (!chats.length) return null;
  return (
    <View style={{ gap: 8 }} testID="agent-map">
      <T variant="overline" tone="muted" accessibilityRole="header" style={{ paddingHorizontal: 4 }}>
        AGENT MAP
      </T>
      <View style={{ gap: 14 }}>
        {chats.map((chat, i) => (
          <ChatBranch key={chat.sessionId} chat={chat} index={i} />
        ))}
      </View>
    </View>
  );
}
