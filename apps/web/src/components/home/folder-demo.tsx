'use client';

import { ArrowLeft, ChevronRight, CircleCheck, Copy, Folder, FolderPlus, Monitor, Plus } from 'lucide-react';
import { Bar, Caret, Collapse, Phone, Prompt, Stage, States, Window, type Act } from './kit';
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
};

async function script(a: Act<F>) {
  await a.wait(800);
  // On the phone: New chat, its sheet rises
  await a.click({ at: 'new-chat', x: 0.5, y: 0.5 });
  await a.set({ sheet: true });
  await a.wait(1000);
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
        {[150, 120, 170, 135, 160, 110, 145, 125].map((w, i) => (
          <div key={i} className="pa-f-behind-row">
            <span className="pa-f-behind-dot" />
            <Bar w={w} h={10} />
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
      compact={{ below: 560, width: 358, height: 660 }}
      initial={START}
      poster={POSTER}
      script={script}
      cursor={{ style: 'touch', at: { wide: { x: 600, y: 560 }, compact: { x: 320, y: 630 } } }}
      className="pa-folders"
      {...look}
    >
      {(s, _rect, layout) => (
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
      )}
    </Stage>
  );
}
