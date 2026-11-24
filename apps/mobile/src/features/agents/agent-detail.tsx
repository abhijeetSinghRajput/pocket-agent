import { buildChat, type ChatItem } from '@pocket-agent/core';
import type { SubagentInfo, WorkerStatus } from '@pocket-agent/protocol';
import { useRouter } from 'expo-router';
import { FileText } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Markdown } from '@/features/chat/markdown';
import { duration } from '@/features/sessions/badges';
import { useSubagent } from '@/lib/data';
import { enter } from '@/lib/motion';
import { fonts, radius, useTheme } from '@/lib/theme';
import { Button, Dot, Press, T } from '@/ui/core';
import { Notice, Skeleton } from '@/ui/feedback';
import { NavBar } from '@/ui/screen';
import { TreeChildren } from './tree';
import { SubagentRow, WorkerBadge } from './worker-row';

type Tool = Extract<ChatItem, { kind: 'tool' }>;
/** Tool calls listed here; the transcript has them all. */
const TOOLS_SHOWN = 40;

const statusOf = (a: SubagentInfo): WorkerStatus => (a.finished ? 'done' : 'running');

/** Opens an agent of this chat (from the map or a parent agent). */
export function useOpenAgent(sessionId: string) {
  const router = useRouter();
  return (toolUseId: string) =>
    router.push({ pathname: '/agent/[sessionId]/[toolUseId]', params: { sessionId, toolUseId } });
}

/** A section of the page: a small heading, then its content. */
function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 2 }}>
        <T variant="overline" tone="muted" accessibilityRole="header">
          {title}
        </T>
        {count !== undefined && (
          <T variant="overline" tone="muted" style={{ opacity: 0.6 }}>
            {count}
          </T>
        )}
      </View>
      {children}
    </View>
  );
}

/** The prompt the agent was given: the first lines, tap for all. */
function Prompt({ text }: { text: string }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const long = text.split('\n').length > 8 || text.length > 600;
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={open ? 'Show less of the prompt' : 'Show the whole prompt'}
      disabled={!long}
      onPress={() => setOpen(!open)}
      scale={0.995}
      dim={false}
      testID="agent-prompt"
      style={{ borderRadius: radius.lg, backgroundColor: c.card, padding: 12, gap: 6 }}
    >
      <Text
        selectable
        numberOfLines={open ? undefined : 8}
        style={{ fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 19, color: c.foreground }}
      >
        {text}
      </Text>
      {long && (
        <T variant="captionMedium" tone="primary">
          {open ? 'Show less' : 'Show all'}
        </T>
      )}
    </Press>
  );
}

/** One tool call, as the editor lists it: a status dot, the tool, what it used. */
function ToolRow({ tool }: { tool: Tool }) {
  const { c } = useTheme();
  const color = tool.state === 'running' ? c.primary : tool.state === 'done' ? c.success : c.destructive;
  return (
    <View
      accessibilityLabel={`${tool.toolName} ${tool.target}, ${tool.state}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 7,
        paddingHorizontal: 12,
      }}
    >
      <Dot color={color} size={7} pulse={tool.state === 'running'} />
      <T variant="smallMedium" style={{ fontFamily: fonts.semibold }}>
        {tool.toolName}
      </T>
      <Text
        numberOfLines={1}
        style={{ flex: 1, minWidth: 0, fontFamily: fonts.mono, fontSize: 12, color: c.mutedForeground }}
      >
        {tool.target}
      </Text>
    </View>
  );
}

/**
 * One sub-agent, like the editor shows it: what it was asked (the prompt), what it did (its tool
 * calls), the agents it started, its answer, and its whole transcript one tap away. Read live from
 * the PC.
 */
export function AgentDetailScreen({ sessionId, toolUseId }: { sessionId: string; toolUseId: string }) {
  const router = useRouter();
  const { c } = useTheme();
  const { state, refresh, refreshing } = useSubagent(sessionId, toolUseId);
  const openAgent = useOpenAgent(sessionId);
  const data = state.data;
  const items = useMemo(() => (data ? buildChat(data.events, []) : []), [data]);

  const agent = data?.agent;
  const prompt = items.find((i) => i.kind === 'user');
  const tools = items.filter((i): i is Tool => i.kind === 'tool');
  const answer = agent?.finished ? [...items].reverse().find((i) => i.kind === 'assistant') : undefined;
  const children = (data?.agents ?? []).filter((a) => a.parentToolUseId === toolUseId);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <NavBar
        title={agent?.description || 'Agent'}
        subtitle={
          agent
            ? `${agent.type}${agent.model ? ` · ${agent.model}` : ''}${agent.startedAt ? ` · ${duration(agent.startedAt, agent.finished ? agent.lastActivityAt : null)}` : ''}`
            : undefined
        }
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 22 }} testID="agent-detail">
        {state.status === 'loading' && (
          <View accessibilityState={{ busy: true }} style={{ gap: 12 }}>
            <Skeleton height={20} width={160} />
            <Skeleton height={140} round={radius.lg} />
            <Skeleton height={220} round={radius.lg} />
          </View>
        )}
        {state.error && (
          <View style={{ gap: 10 }}>
            <Notice>{state.error}</Notice>
            <Button
              label={refreshing ? 'Trying…' : 'Try again'}
              variant="outline"
              onPress={() => void refresh()}
            />
          </View>
        )}

        {agent && (
          <Animated.View
            entering={enter.rise(0)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <WorkerBadge status={statusOf(agent)} />
            {agent.background && (
              <T variant="caption" tone="muted">
                In the background
              </T>
            )}
          </Animated.View>
        )}

        {prompt?.kind === 'user' && (
          <Animated.View entering={enter.rise(1)}>
            <Section title="PROMPT">
              <Prompt text={prompt.text} />
            </Section>
          </Animated.View>
        )}

        {data && (
          <Animated.View entering={enter.rise(2)}>
            <Section title="TOOL CALLS" count={agent?.toolCalls ?? tools.length}>
              {tools.length ? (
                <View
                  style={{ borderRadius: radius.lg, backgroundColor: c.card, paddingVertical: 4 }}
                  testID="agent-tools"
                >
                  {tools.length > TOOLS_SHOWN && (
                    <T variant="caption" tone="muted" style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
                      {tools.length - TOOLS_SHOWN} earlier in the transcript
                    </T>
                  )}
                  {tools.slice(-TOOLS_SHOWN).map((t) => (
                    <ToolRow key={t.key} tool={t} />
                  ))}
                </View>
              ) : (
                <T variant="small" tone="muted">
                  No tool calls yet.
                </T>
              )}
            </Section>
          </Animated.View>
        )}

        {children.length > 0 && (
          <Animated.View entering={enter.rise(3)}>
            <Section title="AGENTS IT STARTED" count={children.length}>
              <View>
                <TreeChildren
                  items={children}
                  keyOf={(a) => a.toolUseId}
                  render={(a) => <SubagentRow agent={a} onPress={() => openAgent(a.toolUseId)} />}
                />
              </View>
            </Section>
          </Animated.View>
        )}

        {answer?.kind === 'assistant' && (
          <Animated.View entering={enter.rise(4)}>
            <Section title="RESULT">
              <View style={{ borderRadius: radius.lg, backgroundColor: c.card, padding: 12 }}>
                <Markdown text={answer.text} contained />
              </View>
            </Section>
          </Animated.View>
        )}

        {data && (
          <Animated.View entering={enter.rise(5)}>
            <Button
              label="Open transcript"
              icon={FileText}
              variant="secondary"
              size="lg"
              full
              testID="open-transcript"
              onPress={() =>
                router.push({
                  pathname: '/agent/[sessionId]/[toolUseId]/transcript',
                  params: { sessionId, toolUseId },
                })
              }
            />
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}
