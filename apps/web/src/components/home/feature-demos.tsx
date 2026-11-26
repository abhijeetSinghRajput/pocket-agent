'use client';

import Image from 'next/image';
import { ArrowUp, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Bar,
  Caret,
  Collapse,
  Field,
  LockScreen,
  Notification,
  Phone,
  Prompt,
  Spinner,
  Stage,
  States,
  Stream,
  WALLPAPER,
  Window,
  type Act,
} from './kit';
import { useStageLook } from './look';
import './home.css';

const CARD = { width: 340, height: 340 };

// ── 1. Connect: the two commands typed on the PC, each real step as it happens ─────────────────

const INSTALL = 'npm i -g @mrcodium/pocket-agent';
const CONNECT = 'pocket-agent connect 7KQ2';

type C = {
  install: string;
  installed: boolean;
  connect: string;
  /** Which line has the caret: 1 install, 2 connect, 3 the next prompt. */
  at: 1 | 2 | 3;
  /** 0 nothing yet, 1 pairing, 2 paired, 3 linked, 4 online. */
  step: number;
  /** The session ends: the terminal fades while it resets, and a fresh one fades in. */
  hidden: boolean;
};

const C0: C = { install: '', installed: false, connect: '', at: 1, step: 0, hidden: false };
const C_POSTER: C = { install: INSTALL, installed: true, connect: CONNECT, at: 3, step: 4, hidden: false };

async function connectScript(a: Act<C>) {
  await a.wait(700);
  await a.type('install', INSTALL, { interval: 45 });
  await a.wait(300);
  await a.set({ installed: true, at: 2 });
  await a.wait(700);
  await a.type('connect', CONNECT, { interval: 45 });
  await a.wait(300);
  await a.set({ step: 1 });
  await a.wait(1100);
  await a.set({ step: 2 });
  await a.wait(500);
  await a.set({ step: 3 });
  await a.wait(500);
  await a.set({ step: 4, at: 3 });
  await a.wait(2400);
  // A fresh session: the old one fades out, resets unseen, the new one fades in
  await a.set({ hidden: true });
  await a.wait(400);
  await a.snap({ ...C0, hidden: true });
  await a.set({ hidden: false });
  await a.wait(500);
}

/** One output line whose mark turns from a spinner into a tick, the words beside it held still. */
function StepLine({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <div className="pa-step">
      <States
        className="pa-step-mark"
        value={done ? 'done' : 'busy'}
        states={{
          busy: (
            <span className="pa-spin">
              <Spinner size={12} />
            </span>
          ),
          done: <span className="ok">✓</span>,
        }}
      />
      {children}
    </div>
  );
}

export function ConnectDemo() {
  const look = useStageLook();
  return (
    <Stage
      {...CARD}
      initial={C0}
      poster={C_POSTER}
      script={connectScript}
      className="pa-feat pa-feat--connect"
      {...look}
    >
      {(s) => (
        <Window
          chrome="terminal"
          lights="grey"
          title="PowerShell"
          className="pa-term"
          data-hidden={s.hidden || undefined}
        >
          {/* What it needs, already checked: Node 24 and Claude Code */}
          <Prompt path="~">node -v</Prompt>
          <div className="dim">v24.7.0</div>
          <Prompt path="~">claude --version</Prompt>
          <div className="dim">2.1.0 (Claude Code)</div>
          <Prompt path="~">
            {s.install}
            {s.at === 1 && <Caret still={s.install.length > 0 && s.install.length < INSTALL.length} />}
          </Prompt>
          <Collapse open={s.installed}>
            <div className="dim">added 38 packages in 9s</div>
          </Collapse>
          <Collapse open={s.at >= 2}>
            <Prompt path="~">
              {s.connect}
              {s.at === 2 && <Caret still={s.connect.length > 0 && s.connect.length < CONNECT.length} />}
            </Prompt>
          </Collapse>
          <Collapse open={s.step >= 1}>
            <StepLine done={s.step >= 2}>
              <States
                align="start"
                value={s.step >= 2 ? 'paired' : 'pairing'}
                states={{
                  pairing: <span className="dim">Pairing…</span>,
                  paired: <span>Paired as “Studio-PC”</span>,
                }}
              />
            </StepLine>
          </Collapse>
          <Collapse open={s.step >= 3}>
            <StepLine done>Claude Code linked</StepLine>
          </Collapse>
          <Collapse open={s.step >= 4}>
            <StepLine done>
              <span>
                Online <span className="dim">· runs in the background</span>
              </span>
            </StepLine>
          </Collapse>
          <Collapse open={s.at === 3}>
            <Prompt path="~">
              <Caret />
            </Prompt>
          </Collapse>
        </Window>
      )}
    </Stage>
  );
}

// ── 2. Steer: Claude answering live, and the next instruction typed and sent from the phone ────

const FIRST = 'Add a dark mode toggle to the header';
const ANSWER = 'Added a toggle next to your avatar. It follows the system theme.';
const NEXT = 'Also remember the choice';

type T = {
  /** Words of Claude's answer shown so far. */
  words: number;
  edit: boolean;
  draft: string;
  typing: boolean;
  sent: boolean;
  /** Claude on the second ask: 1 working, 2 done. */
  second: number;
};

const ANSWER_WORDS = ANSWER.split(' ').length;
const T0: T = { words: 0, edit: false, draft: '', typing: false, sent: false, second: 0 };
const T_POSTER: T = { words: ANSWER_WORDS, edit: true, draft: '', typing: false, sent: true, second: 2 };

async function steerScript(a: Act<T>) {
  await a.wait(800);
  for (let i = 1; i <= ANSWER_WORDS; i++) {
    a.put({ words: i });
    await a.wait(70);
  }
  await a.wait(250);
  await a.set({ edit: true });
  await a.wait(900);
  await a.click({ at: 'steer-composer', x: 0.4, y: 0.5 });
  await a.set({ typing: true });
  await a.type('draft', NEXT);
  await a.wait(300);
  await a.click('steer-send');
  await a.set({ draft: '', typing: false, sent: true });
  await a.wait(700);
  await a.set({ second: 1 });
  await a.wait(1300);
  await a.set({ second: 2 });
  await a.wait(2400);
  // What the loop added leaves, last first
  await a.set({ second: 0 });
  await a.wait(70);
  await a.set({ sent: false });
  await a.wait(70);
  await a.set({ edit: false });
  await a.wait(70);
  await a.set({ words: 0 });
  await a.wait(600);
}

function ToolCheck() {
  return (
    <span className="pa-tool-icon">
      <Check size={16} strokeWidth={2.6} aria-hidden />
    </span>
  );
}

export function SteerDemo() {
  const look = useStageLook();
  return (
    <Stage
      {...CARD}
      initial={T0}
      poster={T_POSTER}
      script={steerScript}
      cursor={{ style: 'touch', at: { x: 300, y: 330 } }}
      className="pa-feat pa-feat--chat"
      {...look}
    >
      {(s) => (
        <Phone width={300} frame="pro" dark={look.theme === 'dark'} className="pa-phone">
          <div className="pa-app pa-app--chat">
            <div className="pa-app-thread">
              <div className="pa-claude">
                <Bar w={250} h={9} tone={1} />
                <Bar w={200} h={9} tone={1} />
                <Bar w={226} h={9} tone={1} />
              </div>
              <div className="pa-bubble">{FIRST}</div>
              <Collapse open={s.words > 0} reveal="drop" from="below">
                <div className="pa-reply-text">
                  <Stream text={ANSWER} count={s.words} />
                </div>
              </Collapse>
              <Collapse open={s.edit} reveal="drop" from="below">
                <div className="pa-tool">
                  <ToolCheck />
                  <span>Edit</span>
                  <span className="pa-tool-file">header.tsx</span>
                </div>
              </Collapse>
              <Collapse open={s.sent} reveal="drop" from="below">
                <div className="pa-bubble">{NEXT}</div>
              </Collapse>
              <Collapse open={s.second > 0} reveal="drop" from="below">
                <div className="pa-tool">
                  <States
                    className="pa-tool-mark"
                    value={s.second >= 2 ? 'tick' : 'spin'}
                    states={{
                      spin: (
                        <span className="pa-tool-icon pa-tool-icon--run">
                          <Spinner size={14} />
                        </span>
                      ),
                      tick: <ToolCheck />,
                    }}
                  />
                  <span>Edit</span>
                  <span className="pa-tool-file">theme.ts</span>
                </div>
              </Collapse>
            </div>
            <div className="pa-composer">
              <Field
                className="pa-field"
                value={s.draft}
                placeholder="Message Claude…"
                focused={s.typing}
                box={{ 'data-target': 'steer-composer', 'data-cursor': 'ibeam' }}
              />
              <span className="pa-send" data-target="steer-send" data-ready={s.draft ? '' : undefined}>
                <ArrowUp size={20} strokeWidth={2.6} aria-hidden />
              </span>
            </div>
          </div>
        </Phone>
      )}
    </Stage>
  );
}

// ── 3. Notify: Claude asks on the locked phone, one notification with its two actions; Allow ─────

type N = { ask: boolean; allowed: boolean };
const N0: N = { ask: false, allowed: false };

async function notifyScript(a: Act<N>) {
  await a.wait(900);
  await a.set({ ask: true });
  await a.wait(1600);
  // Allow, right from the notification: it is answered and goes
  await a.click({ at: 'notif-allow', x: 0.5, y: 0.5 });
  await a.set({ allowed: true });
  await a.wait(650);
  await a.set({ ask: false });
  await a.wait(1100);
  await a.snap({ allowed: false });
  await a.wait(300);
}

function AppIcon() {
  return <Image src="/icons/icon-192.png" alt="" width={38} height={38} style={{ borderRadius: 9 }} />;
}

export function NotifyDemo() {
  const look = useStageLook();
  return (
    <Stage
      {...CARD}
      initial={N0}
      poster={{ ask: true, allowed: false }}
      script={notifyScript}
      cursor={{ style: 'touch', at: { x: 290, y: 320 } }}
      className="pa-feat pa-feat--phone"
      {...look}
    >
      {(s) => (
        <Phone width={300} frame="pro" dark wallpaper={WALLPAPER} className="pa-phone">
          <LockScreen size="satellite" stack="top">
            <Collapse open={s.ask} reveal="drop">
              {/* One notification, with the two actions the app puts on a permission request */}
              <div className="pa-notif-card">
                <Notification
                  time=""
                  icon={<AppIcon />}
                  title="Claude needs your OK"
                  body="pocket_agent wants to run npm test"
                />
                <div className="pa-notif-actions">
                  <span className="pa-notif-action">Deny</span>
                  <span
                    className="pa-notif-action pa-notif-action--allow"
                    data-target="notif-allow"
                    data-on={s.allowed || undefined}
                  >
                    Allow
                  </span>
                </div>
              </div>
            </Collapse>
          </LockScreen>
        </Phone>
      )}
    </Stage>
  );
}
