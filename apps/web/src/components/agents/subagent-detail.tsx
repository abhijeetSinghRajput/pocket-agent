'use client';

import { buildChat, nowDoing, type ChatItem } from '@pocket-agent/core';
import type { SubagentInfo, WorkerStatus } from '@pocket-agent/protocol';
import { ArrowLeft, FileText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { SubagentRow, TreeChildren, WorkerBadge, subagentHref } from '@/components/agents/agent-map';
import { duration } from '@/components/agents/agents-view';
import { ChatMessages } from '@/components/agents/chat-messages';
import { Markdown } from '@/components/agents/markdown';
import { Button, buttonVariants } from '@/components/ui/button';
import { useSubagent, useWorkers } from '@/lib/use-workers';
import { cn } from '@/lib/utils';

// The web port of the app's sub-agent page and transcript (apps/mobile/src/features/agents/
// agent-detail.tsx, agent-transcript.tsx): the same sections, the same words, the same data.

type Tool = Extract<ChatItem, { kind: 'tool' }>;
/** Tool calls listed here; the transcript has them all. */
const TOOLS_SHOWN = 40;

const statusOf = (a: SubagentInfo): WorkerStatus => (a.finished ? 'done' : 'running');

/** The page's bar: back, then the title and a line under it (the app's NavBar). */
function Bar({ title, subtitle, back }: { title: string; subtitle?: string; back: string }) {
  const router = useRouter();
  return (
    <header className="z-10 flex h-16 shrink-0 items-center gap-1 border-b bg-card/90 px-1.5 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:px-3">
      <Link
        href={back}
        onClick={(e) => {
          // Back where you came from when there is history (the map, a parent agent); else up.
          if (window.history.length > 1) {
            e.preventDefault();
            router.back();
          }
        }}
        aria-label="Back"
        className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </Link>
      <div className="min-w-0 flex-1 pl-1">
        <h1 className="truncate text-[15px] leading-tight font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </header>
  );
}

/** A section of the page: a small heading, then its content. */
function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex gap-1.5 px-0.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
        {count !== undefined && <span className="opacity-60">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

/** The prompt the agent was given: the first lines, click for all. */
function Prompt({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.split('\n').length > 8 || text.length > 600;
  return (
    <button
      type="button"
      disabled={!long}
      onClick={() => setOpen(!open)}
      aria-label={long ? (open ? 'Show less of the prompt' : 'Show the whole prompt') : undefined}
      data-testid="agent-prompt"
      className="flex flex-col gap-1.5 rounded-xl bg-card p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-text"
    >
      <span
        className={cn(
          'font-mono text-[12.5px] leading-[19px] break-words whitespace-pre-wrap select-text',
          !open && 'line-clamp-8',
        )}
      >
        {text}
      </span>
      {long && <span className="text-xs font-medium text-primary">{open ? 'Show less' : 'Show all'}</span>}
    </button>
  );
}

/** One tool call, as the editor lists it: a status dot, the tool, what it used. */
function ToolRow({ tool }: { tool: Tool }) {
  const dot =
    tool.state === 'running' ? 'bg-primary animate-pulse' : tool.state === 'done' ? 'bg-success' : 'bg-destructive';
  return (
    <div
      aria-label={`${tool.toolName} ${tool.target}, ${tool.state}`}
      className="flex items-center gap-2.5 px-3 py-[7px]"
    >
      <span aria-hidden className={cn('size-[7px] shrink-0 rounded-full', dot)} />
      <span className="text-sm font-semibold">{tool.toolName}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{tool.target}</span>
    </div>
  );
}

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <div className="h-5 w-40 animate-pulse rounded bg-muted" />
      <div className="h-36 animate-pulse rounded-xl bg-muted" />
      <div className="h-56 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

/**
 * One sub-agent, like the editor shows it: what it was asked (the prompt), what it did (its tool
 * calls), the agents it started, its answer, and its whole transcript one click away. Read live
 * from the PC.
 */
export function SubagentDetail({ sessionId, toolUseId }: { sessionId: string; toolUseId: string }) {
  const { state, refresh } = useSubagent(sessionId, toolUseId);
  const [retrying, setRetrying] = useState(false);
  // Its summary comes with the agent map (already loaded, also while the PC is offline).
  const summary = useWorkers().state.data?.find((w) => w.sessionId === sessionId && w.id === toolUseId)?.summary;
  const data = state.data;
  const items = useMemo(() => (data ? buildChat(data.events, []) : []), [data]);

  const agent = data?.agent;
  const prompt = items.find((i) => i.kind === 'user');
  const tools = items.filter((i): i is Tool => i.kind === 'tool');
  const answer = agent?.finished ? [...items].reverse().find((i) => i.kind === 'assistant') : undefined;
  const children = (data?.agents ?? []).filter((a) => a.parentToolUseId === toolUseId);
  const now = agent ? nowDoing(agent) : null;

  return (
    <div className="flex h-[var(--chat-height,100dvh)] flex-col overflow-hidden bg-background">
      <Bar
        back="/agents"
        title={agent?.description || 'Agent'}
        subtitle={
          agent
            ? `${agent.type}${agent.model ? ` · ${agent.model}` : ''}${agent.startedAt ? ` · ${duration(agent.startedAt, agent.finished ? agent.lastActivityAt : null)}` : ''}`
            : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div data-testid="agent-detail" className="stagger mx-auto flex max-w-3xl flex-col gap-[22px] p-4 pb-12 sm:px-6">
          {state.status === 'loading' && <Loading />}
          {state.error && (
            <div className="flex flex-col gap-2.5">
              <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                {state.error}
              </p>
              <Button
                variant="outline"
                disabled={retrying}
                onClick={() => {
                  setRetrying(true);
                  void refresh().finally(() => setRetrying(false));
                }}
              >
                {retrying ? 'Trying…' : 'Try again'}
              </Button>
            </div>
          )}

          {agent && (
            <div className="flex items-center gap-2">
              <WorkerBadge status={statusOf(agent)} />
              {agent.background && <span className="text-xs text-muted-foreground">In the background</span>}
            </div>
          )}

          {/* What it is doing this moment (refreshes as the chat reports its steps). */}
          {now && (
            <Section title="Now">
              <p key={now} data-testid="agent-detail-now" className="roll-in line-clamp-3 font-mono text-[13px] leading-[19px]">
                {now}
              </p>
            </Section>
          )}

          {/* How it ended, in Claude Code's words: the line the agent map cuts short, in full. */}
          {summary && (
            <Section title="Summary">
              <p data-testid="agent-summary" className="text-sm leading-[21px] select-text">
                {summary}
              </p>
            </Section>
          )}

          {prompt?.kind === 'user' && (
            <Section title="Prompt">
              <Prompt text={prompt.text} />
            </Section>
          )}

          {data && (
            <Section title="Tool calls" count={agent?.toolCalls ?? tools.length}>
              {tools.length ? (
                <div data-testid="agent-tools" className="rounded-xl bg-card py-1">
                  {tools.length > TOOLS_SHOWN && (
                    <p className="px-3 py-1.5 text-xs text-muted-foreground">
                      {tools.length - TOOLS_SHOWN} earlier in the transcript
                    </p>
                  )}
                  {tools.slice(-TOOLS_SHOWN).map((t) => (
                    <ToolRow key={t.key} tool={t} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No tool calls yet.</p>
              )}
            </Section>
          )}

          {children.length > 0 && (
            <Section title="Agents it started" count={children.length}>
              <div>
                <TreeChildren
                  items={children}
                  keyOf={(a) => a.toolUseId}
                  render={(a) => <SubagentRow sessionId={sessionId} agent={a} />}
                />
              </div>
            </Section>
          )}

          {answer?.kind === 'assistant' && (
            <Section title="Result">
              <div className="rounded-xl bg-card p-3">
                <Markdown text={answer.text} />
              </div>
            </Section>
          )}

          {data && (
            <Link
              href={`${subagentHref(sessionId, toolUseId)}/transcript`}
              data-testid="open-transcript"
              className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'w-full')}
            >
              <FileText aria-hidden />
              Open transcript
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A sub-agent's whole transcript, drawn like a chat: its prompt, what it said, every tool call with
 * its output. The same data as the agent's page (one request for both).
 */
export function SubagentTranscript({ sessionId, toolUseId }: { sessionId: string; toolUseId: string }) {
  const { state } = useSubagent(sessionId, toolUseId);
  const data = state.data;
  const items = useMemo(() => (data ? buildChat(data.events, []) : []), [data]);
  const running = data ? !data.agent.finished : false;
  return (
    <div className="flex h-[var(--chat-height,100dvh)] flex-col overflow-hidden bg-background">
      <Bar back={subagentHref(sessionId, toolUseId)} title="Transcript" subtitle={data?.agent.description} />
      {state.status === 'loading' && (
        <div aria-busy="true" className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4 sm:px-6">
          <div className="h-[90px] animate-pulse rounded-xl bg-muted" />
          <div className="h-10 animate-pulse rounded-xl bg-muted" />
          <div className="h-10 animate-pulse rounded-xl bg-muted" />
        </div>
      )}
      {state.error && (
        <p role="alert" className="m-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {data && (
        <ChatMessages
          items={items}
          typing={running ? 'working' : null}
          header={
            data.truncated ? (
              <p className="text-center text-xs text-muted-foreground">
                The first steps are left out: the transcript is longer than one answer from your PC.
              </p>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
