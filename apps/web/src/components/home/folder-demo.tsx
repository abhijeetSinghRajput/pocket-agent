'use client';

import {
  ArrowLeft,
  Bot,
  ChevronRight,
  CircleCheck,
  Copy,
  Folder,
  FolderPlus,
  Monitor,
  Plus,
  Search,
} from 'lucide-react';
import { Camera, Caret, Collapse, Phone, Prompt, Stage, States, Window, type Act, type Rect } from './kit';
import type { ProviderId } from '@pocket-agent/protocol';
import { AgentLogo, AGENT_LOGOS } from '@/components/agents/agent-logos';
import { useStageLook } from './look';
import './home.css';

// Allowing a folder, as it is done: on the phone, New chat lists the PC's workspaces and ends with
// "Add a workspace"; a tap there shows the one command to run on the PC (only the PC decides which
// folders the phone may use). The command is typed in the PC's terminal, the PC answers "Allowed",
// the phone sees the new folder, and Done shows it in the list, ready for a chat. Words as the
// app and the CLI say them (apps/mobile/src/features/sessions/new-chat-sheet.tsx,
// apps/local-agent/src/cli.ts).

const COMMAND = String.raw`pocket-agent projects add C:\work\my-app`;
const FOLDER = String.raw`C:\work\my-app`;

type F = {
  /** New chat was tapped: its sheet is up over the chats. */
  sheet: boolean;
  /** What the phone's sheet shows: the workspaces, or how to add one. */
  view: 'list' | 'add';
  cmd: string;
  /** The command ran: the PC's answer. */
  ran: boolean;
  /** The phone saw the new folder. */
  added: boolean;
  /** The new folder in the phone's list. */
  listed: boolean;
  /** The loop's end: both screens fade while they reset. */
  hidden: boolean;
  /** Where the eye belongs now: that device shows in full, the other steps back. */
  focus: 'pc' | 'phone' | 'both';
  /** The camera: pushed in on this (New chat, as it is tapped), or null for the whole scene. */
  zoom: Rect | null;
};

const START: F = {
  sheet: false,
  view: 'list',
  cmd: '',
  ran: false,
  added: false,
  listed: false,
  hidden: false,
  focus: 'phone',
  zoom: null,
};
const POSTER: F = {
  sheet: true,
  view: 'list',
  cmd: COMMAND,
  ran: true,
  added: true,
  listed: true,
  hidden: false,
  focus: 'both',
  zoom: null,
};

/** How long the camera takes to move in or back out. */
const CAMERA = 1000;

async function script(a: Act<F>) {
  await a.wait(800);
  // On the phone: the camera moves in on New chat, it is tapped, its sheet rises, the camera pulls back
  await a.set({ zoom: a.rect('new-chat', { layout: true }) });
  await a.wait(CAMERA + 100);
  await a.click({ at: 'new-chat', x: 0.5, y: 0.5 });
  await a.set({ sheet: true });
  await a.wait(500);
  await a.set({ zoom: null });
  await a.wait(CAMERA);
  // Add a workspace
  await a.click({ at: 'add-row', x: 0.35, y: 0.5 });
  await a.set({ view: 'add' });
  await a.wait(1300);
  // On the PC: the one command
  await a.set({ focus: 'pc' });
  await a.wait(450);
  await a.type('cmd', COMMAND, { interval: 42 });
  await a.wait(350);
  await a.set({ ran: true });
  await a.wait(800);
  // The phone sees it
  await a.set({ focus: 'phone' });
  await a.wait(300);
  await a.set({ added: true });
  await a.wait(1300);
  await a.click({ at: 'add-done', x: 0.5, y: 0.5 });
  await a.set({ view: 'list' });
  await a.wait(250);
  await a.set({ listed: true });
  await a.wait(3200);
  await a.set({ hidden: true });
  await a.wait(420);
  await a.snap({ ...START, hidden: true });
  await a.set({ hidden: false });
  await a.wait(500);
}

function Terminal({ s }: { s: F }) {
  return (
    <Window
      chrome="terminal"
      lights="grey"
      title="PowerShell — Studio-PC"
      className="pa-f-term pa-dimmable"
      data-dim={s.focus === 'phone' || undefined}
    >
      <Prompt path="~">pocket-agent status</Prompt>
      <div>
        <span className="ok">✓</span> Online <span className="dim">· Studio-PC</span>
      </div>
      {/* The command that allows the folder, in the accent */}
      <Prompt path="~" className="pa-f-the-cmd">
        {s.cmd}
        {!s.ran && <Caret still={s.cmd.length > 0 && s.cmd.length < COMMAND.length} />}
      </Prompt>
      <Collapse open={s.ran}>
        <div>
          <span className="ok">✓</span> Allowed: <span className="pa-f-allowed">{FOLDER}</span>
        </div>
      </Collapse>
      <Collapse open={s.ran}>
        <Prompt path="~">
          <Caret />
        </Prompt>
      </Collapse>
    </Window>
  );
}

function FolderRow({ name, path, target }: { name: string; path: string; target?: string }) {
  return (
    <div className="pa-f-row" data-target={target}>
      <Folder className="pa-f-folder" size={34} strokeWidth={1.2} aria-hidden />
      <div className="pa-f-text">
        <div className="pa-f-name">{name}</div>
        <div className="pa-f-path">{path}</div>
      </div>
      <ChevronRight size={18} className="pa-f-chev" aria-hidden />
    </div>
  );
}

function ListView({ s }: { s: F }) {
  return (
    <div className="pa-f-view">
      <div className="pa-f-title">New chat</div>
      <div className="pa-f-desc">Pick a folder on your PC. Claude Code starts there.</div>
      <div className="pa-f-over">Workspaces on Studio-PC</div>
      <FolderRow name="projects" path={String.raw`C:\Users\you\projects`} />
      <Collapse open={s.listed}>
        <div className="pa-f-new">
          <FolderRow name="my-app" path={FOLDER} />
        </div>
      </Collapse>
      <div className="pa-f-addbtn" data-target="add-row">
        <FolderPlus size={18} strokeWidth={2} aria-hidden /> Add a workspace
      </div>
    </div>
  );
}

function AddView({ s }: { s: F }) {
  return (
    <div className="pa-f-view">
      <div className="pa-f-head">
        <ArrowLeft size={22} strokeWidth={2.2} aria-hidden />
        <span className="pa-f-title">Add a workspace</span>
      </div>
      <div className="pa-f-runon">
        <Monitor size={16} strokeWidth={2} aria-hidden /> Run on <b>Studio-PC</b>
      </div>
      <div className="pa-f-cmd">
        <span className="pa-f-accent">❯</span> pocket-agent projects add{' '}
        <span className="pa-f-accent">&quot;C:\path\to\folder&quot;</span>
      </div>
      <div className="pa-f-primary" data-target="add-done">
        <States
          value={s.added ? 'done' : 'copy'}
          states={{
            copy: (
              <span className="pa-f-btnlabel">
                <Copy size={18} strokeWidth={2.2} aria-hidden /> Copy command
              </span>
            ),
            done: (
              <span className="pa-f-btnlabel">
                <CircleCheck size={18} strokeWidth={2.2} aria-hidden /> Done
              </span>
            ),
          }}
        />
      </div>
      <div className="pa-f-status" data-done={s.added || undefined}>
        <States
          className="pa-f-status-mark"
          value={s.added ? 'done' : 'wait'}
          states={{
            wait: <span className="pa-f-dot" />,
            done: <CircleCheck size={16} strokeWidth={2.4} />,
          }}
        />
        <States
          align="start"
          value={s.added ? 'done' : 'wait'}
          states={{
            wait: <span className="pa-f-muted">Waiting for folder…</span>,
            done: (
              <span>
                <b>my-app</b> was added
              </span>
            ),
          }}
        />
      </div>
    </div>
  );
}

/**
 * The chats already on the phone, behind the sheet: one per agent Pocket Agent connects to, some
 * working, some waiting on you, some finished (the states the app's chat list shows).
 */
// Words and colours from the app's chat list (apps/mobile/src/features/sessions/badges.tsx).
type ChatState = 'running' | 'permission' | 'input' | 'ended';
const CHATS: { agent: ProviderId; folder: string; last: string; time: string; state: ChatState }[] = [
  {
    agent: 'antigravity',
    folder: 'my-app',
    last: 'Use the logo from the brand kit',
    time: '1:16 AM',
    state: 'running',
  },
  {
    agent: 'claude-code',
    folder: 'my-app',
    last: 'Fix the failing login test',
    time: '1:15 AM',
    state: 'permission',
  },
  {
    agent: 'codex',
    folder: 'projects',
    last: 'Add rate limits to the API',
    time: '12:58 AM',
    state: 'input',
  },
  {
    agent: 'cursor',
    folder: 'projects',
    last: 'Refactor the settings page',
    time: '12:40 AM',
    state: 'running',
  },
  { agent: 'copilot', folder: 'my-app', last: 'Tests for the CSV parser', time: 'Yesterday', state: 'ended' },
  { agent: 'opencode', folder: 'projects', last: 'Update the README', time: 'Yesterday', state: 'ended' },
];
const STATE_LABEL: Record<ChatState, string> = {
  running: 'Running',
  permission: 'Needs permission',
  input: 'Waiting for input',
  ended: 'Ended',
};

/** The phone: the chats, and New chat's sheet rising over them (the chats dim under it). */
function Screen({ s }: { s: F }) {
  return (
    <div className="pa-f-screen" data-sheet={s.sheet || undefined}>
      <div className="pa-f-behind" aria-hidden>
        <div className="pa-f-behind-head">
          <span className="pa-f-behind-title">Chats</span>
          <span className="pa-f-newchat" data-target="new-chat">
            <Plus size={16} strokeWidth={2.6} aria-hidden /> New chat
          </span>
        </div>
        <div className="pa-f-tabs">
          <span>Active</span>
          <span data-on="">All</span>
          <span>Archived</span>
        </div>
        <div className="pa-f-search">
          <Search size={15} strokeWidth={2.2} aria-hidden /> Search
        </div>
        {CHATS.map((chat) => (
          <div key={chat.agent} className="pa-f-chat" data-state={chat.state}>
            <span
              className="pa-f-chat-avatar"
              style={{ background: `color-mix(in srgb, ${AGENT_LOGOS[chat.agent].hex} 16%, #f4efe9)` }}
            >
              <AgentLogo provider={chat.agent} className="pa-f-chat-logo" />
              <span className="pa-f-chat-dot" />
            </span>
            <span className="pa-f-chat-text">
              <span className="pa-f-chat-line">
                <span className="pa-f-chat-title">{chat.folder}</span>
                <span className="pa-f-chat-time">{chat.time}</span>
              </span>
              <span className="pa-f-chat-last">{chat.last}</span>
              <span className="pa-f-chat-line pa-f-chat-meta">
                <span className="pa-f-chat-state">{STATE_LABEL[chat.state]}</span>
                <span className="pa-f-chat-pc">
                  <Bot size={11} strokeWidth={2.4} aria-hidden />
                </span>
                Studio-PC
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="pa-f-sheet">
        <span className="pa-f-handle" />
        <States
          align="start"
          value={s.view}
          states={{ list: <ListView s={s} />, add: <AddView s={s} /> }}
          className="pa-f-views"
        />
      </div>
    </div>
  );
}

export function FolderDemo() {
  const look = useStageLook();
  return (
    <Stage
      width={660}
      height={600}
      compact={{ below: 560, width: 358, height: 530 }}
      initial={START}
      poster={POSTER}
      script={script}
      cursor={{ style: 'touch', at: { wide: { x: 600, y: 560 }, compact: { x: 320, y: 500 } } }}
      className="pa-folders"
      {...look}
    >
      {(s, _rect, layout) => (
        <Camera focus={s.zoom} max={1.9} duration={CAMERA} feather={0} className="pa-f-camera">
          <div className="pa-f-stage" data-layout={layout} data-hidden={s.hidden || undefined}>
            <Terminal s={s} />
            <Phone
              width={layout === 'compact' ? 250 : 290}
              screenHeight={820}
              frame="android"
              className="pa-f-phone pa-dimmable"
              data-dim={s.focus === 'pc' || undefined}
            >
              <Screen s={s} />
            </Phone>
          </div>
        </Camera>
      )}
    </Stage>
  );
}
