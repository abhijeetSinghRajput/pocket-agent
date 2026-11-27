'use client';

import { agentProduct, nowDoing } from '@pocket-agent/core';
import type { SubagentInfo, WorkerDto, WorkerStatus } from '@pocket-agent/protocol';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AgentLogo, agentBackdrop, agentInk } from '@/components/agents/agent-logos';
import { duration } from '@/components/agents/agents-view';
import { timeAgo } from '@/lib/format';
import { routes } from '@/lib/nav';
import { useSubagent } from '@/lib/use-workers';
import { cn } from '@/lib/utils';

// The web port of the app's agent map (apps/mobile/src/features/agents/agent-map.tsx,
// worker-row.tsx, tree.tsx). A sub-agent opens its own page (subagent-detail.tsx); a workflow, its chat.

/** Running is green; finished work steps back (muted); a failure stands out. */
const STATUS: Record<WorkerStatus, { label: string; pill: string; dot: string }> = {
  running: { label: 'Running', pill: 'bg-success/14 text-success', dot: 'bg-success animate-pulse' },
  done: { label: 'Done', pill: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/55' },
  failed: { label: 'Failed', pill: 'bg-destructive/14 text-destructive', dot: 'bg-muted-foreground/55' },
  stopped: { label: 'Stopped', pill: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/55' },
};

/** Where a row's status dot sits from its top (on its title's first line), and the branch meets it. */
const ROW_DOT_Y = 23;

/** One child in the tree: a line comes down from the parent and turns into the row (├──, └──). */
function TreeBranch({ last, children }: { last: boolean; children: ReactNode }) {
  return (
    <div className="relative pl-7">
      <span
        aria-hidden
        className={cn('absolute left-[13px] top-0 w-[1.5px] bg-muted-foreground/35', last && 'rounded-bl-md')}
        style={{ height: last ? ROW_DOT_Y : '100%' }}
      />
      <span
        aria-hidden
        className="absolute left-[13px] h-[1.5px] w-[13px] bg-muted-foreground/35"
        style={{ top: ROW_DOT_Y - 1 }}
      />
      {children}
    </div>
  );
}

const whenOf = (status: WorkerStatus, startedAt: string, endedAt: string | null) =>
  status === 'running' ? `for ${duration(startedAt, null)}` : timeAgo(endedAt ?? startedAt);

/** A sub-agent's page in a chat, and its whole transcript. */
export const subagentHref = (sessionId: string, toolUseId: string) =>
  routes.subagent(sessionId, toolUseId);

/** A worker's status as a pill; a running one breathes. */
export function WorkerBadge({ status }: { status: WorkerStatus }) {
  const s = STATUS[status];
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium', s.pill)}>
      {status === 'running' && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-success" />}
      <span key={s.label} className="roll-in">
        {s.label}
      </span>
    </span>
  );
}

/**
 * One agent in the map: a status dot where its branch meets it, its task across the whole width,
 * then what it is and when, how it ended, and its status.
 */
function AgentRow({
  href,
  title,
  meta,
  time,
  summary,
  now,
  status,
  label,
}: {
  href: string;
  title: string;
  meta: string;
  time: string | null;
  summary?: string | null;
  now?: string | null;
  status: WorkerStatus;
  label: string;
}) {
  const s = STATUS[status];
  const running = status === 'running';
  return (
    <Link
      href={href}
      data-testid="worker-row"
      aria-label={label}
      className="flex items-start gap-2.5 rounded-lg py-3 pr-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99]"
    >
      <span aria-hidden className={cn('mt-[7px] size-2 shrink-0 rounded-full', s.dot)} />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="line-clamp-2 text-[15px] leading-[21px] font-semibold">{title}</span>
        <span className="truncate text-xs text-muted-foreground tabular-nums">{meta}</span>
        {now && (
          <span key={now} data-testid="agent-now" className="roll-in truncate font-mono text-[12.5px] text-success">
            {now}
          </span>
        )}
        {summary && <span className="line-clamp-2 text-sm text-foreground/75">{summary}</span>}
        <span className="mt-1 flex items-center gap-2">
          <WorkerBadge status={status} />
          {time && (
            <span className={cn('text-xs tabular-nums', running ? 'text-success' : 'text-muted-foreground')}>
              {time}
            </span>
          )}
        </span>
      </span>
      <ChevronRight className="mt-0.5 size-[18px] shrink-0 text-muted-foreground/60" aria-hidden />
    </Link>
  );
}

/** A background worker of a chat: a sub-agent opens its own page, a workflow its chat. */
function WorkerRow({ w, now }: { w: WorkerDto; now: string | null }) {
  const kind = w.kind === 'workflow' ? 'Workflow' : 'Sub-agent';
  const meta = [w.label && w.label !== w.title ? w.label : kind, w.background ? 'background' : null]
    .filter(Boolean)
    .join(' · ');
  const running = w.status === 'running';
  const sub = w.kind === 'subagent';
  return (
    <AgentRow
      href={sub ? routes.subagent(w.sessionId, w.id) : routes.chat(w.sessionId)}
      title={w.title}
      meta={meta}
      time={whenOf(w.status, w.startedAt, w.finishedAt)}
      summary={running ? null : w.summary}
      now={running ? now : null}
      status={w.status}
      label={`${kind}: ${w.title}, ${STATUS[w.status].label}, in ${w.projectName}. ${sub ? 'Open' : 'Open chat'}`}
    />
  );
}

/** A sub-agent another agent started, as its page lists them. */
export function SubagentRow({ sessionId, agent: a }: { sessionId: string; agent: SubagentInfo }) {
  const status: WorkerStatus = a.finished ? 'done' : 'running';
  return (
    <AgentRow
      href={subagentHref(sessionId, a.toolUseId)}
      title={a.description || a.type}
      meta={`${a.type} · ${a.toolCalls} tool call${a.toolCalls === 1 ? '' : 's'}`}
      time={a.startedAt ? whenOf(status, a.startedAt, a.lastActivityAt) : null}
      now={nowDoing(a)}
      status={status}
      label={`${a.type}: ${a.description}, ${STATUS[status].label}. Open`}
    />
  );
}

/** Rows hanging off a parent, each on its own branch of the tree. */
export function TreeChildren<T>({
  items,
  keyOf,
  render,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
}) {
  return items.map((item, i) => (
    <TreeBranch key={keyOf(item)} last={i === items.length - 1}>
      {render(item)}
    </TreeBranch>
  ));
}

interface Chat {
  sessionId: string;
  projectName: string;
  deviceName: string;
  provider: WorkerDto['provider'];
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
      provider: w.provider,
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

/** A chat at the root of its branch, with its own agent's logo (ringed while its agents run). */
function ChatNode({ chat }: { chat: Chat }) {
  return (
    <Link
      href={routes.chat(chat.sessionId)}
      data-testid="agent-map-chat"
      aria-label={`${agentProduct(chat.provider)} chat ${chat.projectName}, ${chat.workers.length} agents. Open chat`}
      className="flex items-center gap-2.5 rounded-lg py-1.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span
        className={cn(
          'agent-ink grid size-[30px] shrink-0 place-items-center rounded-full border-[1.5px]',
          chat.running ? 'border-primary' : 'border-transparent',
        )}
        style={{ ...agentInk(chat.provider), backgroundColor: agentBackdrop(chat.provider) }}
      >
        <AgentLogo provider={chat.provider} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{chat.projectName}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {chat.deviceName} · {chat.workers.length} agent{chat.workers.length === 1 ? '' : 's'}
          {chat.running ? ` · ${chat.running} running` : ''}
        </span>
      </span>
    </Link>
  );
}

type NowOf = (toolUseId: string) => string | null;
const NOTHING: NowOf = () => null;

function BranchView({ chat, nowOf }: { chat: Chat; nowOf: NowOf }) {
  return (
    <div>
      <ChatNode chat={chat} />
      {chat.workers.map((w, i) => (
        <TreeBranch key={w.id} last={i === chat.workers.length - 1}>
          <WorkerRow w={w} now={nowOf(w.id)} />
        </TreeBranch>
      ))}
    </div>
  );
}

/** A chat with sub-agents running: what each is doing now, read live from its PC. */
function LiveBranch({ chat, probe }: { chat: Chat; probe: string }) {
  const agents = useSubagent(chat.sessionId, probe).state.data?.agents ?? [];
  const nowOf: NowOf = (id) => {
    const a = agents.find((x) => x.toolUseId === id);
    return a ? nowDoing(a) : null;
  };
  return <BranchView chat={chat} nowOf={nowOf} />;
}

function ChatBranch({ chat }: { chat: Chat }) {
  const probe = chat.workers.find((w) => w.kind === 'subagent' && w.status === 'running');
  return probe ? <LiveBranch chat={chat} probe={probe.id} /> : <BranchView chat={chat} nowOf={NOTHING} />;
}

/** Every chat that started sub-agents or workflows, each with its agents branching off it. */
export function AgentMap({ workers }: { workers: readonly WorkerDto[] }) {
  const chats = byChat(workers);
  if (!chats.length) return null;
  return (
    <section className="flex flex-col gap-2" data-testid="agent-map">
      <h2 className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Agent map</h2>
      <div className="stagger flex flex-col gap-3.5">
        {chats.map((chat) => (
          <ChatBranch key={chat.sessionId} chat={chat} />
        ))}
      </div>
    </section>
  );
}
