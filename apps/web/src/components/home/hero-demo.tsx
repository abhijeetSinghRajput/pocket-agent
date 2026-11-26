'use client';

import Image from 'next/image';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  ArrowUp,
  Check,
  CheckCheck,
  Clock,
  MessageSquare,
  Mic,
  Plus,
  ShieldQuestion,
  Smartphone,
  X,
  Zap,
} from 'lucide-react';
import {
  Button,
  Collapse,
  Field,
  Phone,
  Spinner,
  Stage,
  States,
  Window,
  type Act,
  type Rect,
} from './kit';
import { useStageLook } from './look';
import './home.css';

// The hero: what Pocket Agent is for, in one event. A task typed on the phone
// lands in Claude Code on the PC; Claude works, then needs a yes to run the
// tests; the phone asks, the person taps Allow, the question goes away and the
// PC carries on to the result. Real words: the task, the command, Allow, the
// test result, the reply. Everything else is the product's chrome or filler.
//
// The phone is cropped at the top (inside the thread, below its header) so
// its composer shows: the conversation sits on the composer and grows upward,
// as a chat does.

type S = {
  draft: string;
  typing: boolean;
  /** The task left the phone: its bubble in the thread. */
  sent: boolean;
  /** The task reached Claude Code on the PC. */
  arrived: boolean;
  /** Claude's work so far: 1 the finding, 2 the edit. */
  work: number;
  /** Claude asks to run the tests: the Bash lines on the PC, the card on the phone. */
  ask: boolean;
  allowed: boolean;
  /** The question answered and gone from the phone. */
  closed: boolean;
  passed: boolean;
  /** Claude's last reply, on the PC. */
  done: boolean;
  /** What reached the phone over the link: the question, and the reply. */
  asked: boolean;
  replied: boolean;
  /**
   * Room made for what a message becomes, before it flies: the space opens (and the thread or the
   * output moves) with the element still hidden, so the message can land on its real place and size.
   */
  roomUser: boolean;
  roomAsk: boolean;
  roomReply: boolean;
  /** The Allow reached the PC. */
  run: boolean;
  /** The message on the link right now: a counter that restarts its trip, and which way it goes. */
  packet: number;
  dir: 'pc' | 'phone';
  kind: 'msg' | 'ask' | 'ok' | 'done';
};

const START: S = {
  draft: '',
  typing: false,
  sent: false,
  arrived: false,
  work: 0,
  ask: false,
  allowed: false,
  closed: false,
  passed: false,
  done: false,
  asked: false,
  replied: false,
  roomUser: false,
  roomAsk: false,
  roomReply: false,
  run: false,
  packet: 0,
  dir: 'pc',
  kind: 'msg',
};
const POSTER: S = {
  ...START,
  sent: true,
  arrived: true,
  work: 2,
  ask: true,
  allowed: true,
  closed: true,
  passed: true,
  done: true,
  asked: true,
  replied: true,
  roomUser: true,
  roomAsk: true,
  roomReply: true,
  run: true,
};

const PROMPT = 'Fix the failing login test';
const REPLY = 'All tests pass. The login test is fixed.';
/** How long a message takes along the link. */
const TRIP = 900;
/** How long the morphed message stays over the real one appearing under it. */
const HANDOVER = 320;
/** When the message reaches the other screen: the element it becomes opens there and then. */
const LANDED = Math.round((TRIP + HANDOVER) * 0.7);
const REST = { wide: { x: 820, y: 500 }, compact: { x: 200, y: 480 } };

async function script(a: Act<S>) {
  await a.wait(900);
  // The task, typed on the phone and sent
  a.mark('type');
  await a.click({ at: 'composer', x: 0.4, y: 0.5 });
  await a.set({ typing: true });
  await a.type('draft', PROMPT);
  await a.wait(350);
  a.mark('send');
  await a.click('send');
  await a.set({ draft: '', typing: false, sent: true });
  // Over the link to the PC, landing as the prompt line
  await a.set((st) => ({ packet: st.packet + 1, dir: 'pc', kind: 'msg' }));
  await a.wait(LANDED);
  // It lands in Claude Code, which gets to work
  await a.set({ arrived: true, roomUser: true });
  await a.wait(800);
  await a.set({ work: 1 });
  await a.wait(650);
  await a.set({ work: 2 });
  await a.wait(900);
  // Claude needs a yes: it waits on the PC, and the question travels to the phone
  a.mark('ask');
  await a.set((st) => ({ ask: true, packet: st.packet + 1, dir: 'phone', kind: 'ask' }));
  await a.wait(LANDED);
  await a.set({ asked: true, roomAsk: true });
  await a.wait(1700);
  a.mark('allow');
  await a.click({ at: 'allow', x: 0.62, y: 0.55 });
  await a.set((st) => ({ allowed: true, packet: st.packet + 1, dir: 'pc', kind: 'ok' }));
  await a.wait(LANDED);
  // The yes reaches the PC: the run starts, and the question goes from the phone
  await a.set({ run: true, closed: true });
  await a.wait(1000);
  a.mark('passed');
  await a.set({ passed: true });
  await a.wait(700);
  await a.set((st) => ({ done: true, packet: st.packet + 1, dir: 'phone', kind: 'done' }));
  await a.wait(LANDED);
  await a.set({ replied: true, roomReply: true });
  a.mark('done');
  await a.wait(2600);
  // Ready for the next task: what this one added leaves, last first
  for (const patch of [
    { replied: false, roomReply: false, done: false },
    { passed: false },
    { work: 0, ask: false, asked: false, roomAsk: false },
    { arrived: false, roomUser: false },
  ]) {
    await a.set(patch);
    await a.wait(70);
  }
  await a.set({ sent: false });
  await a.wait(700);
  await a.snap({ allowed: false, closed: false, run: false });
  await a.move(REST[a.layout]);
  await a.wait(300);
}

function Terminal({ s }: { s: S }) {
  return (
    <Window chrome="terminal" lights="grey" title="pocket_agent — claude" className="pa-term">
      <div className="pa-term-welcome">
        <span className="pa-term-mark">✻</span> Welcome to <span className="pa-term-strong">Claude Code</span>
        {'\n'}
        <span className="dim"> cwd: ~/projects/pocket_agent</span>
      </div>
      <div className="pa-term-past">&gt; Why does sign-in fail after an hour?</div>
      <div className="pa-term-past">
        <span className="pa-term-dot">⏺</span> The expiry check looks wrong. Fix it?
      </div>
      <Grow open={s.roomUser} from="top">
        <div className="pa-term-user pa-morph-in" data-target="term-user" data-morph="line">
          <span className="dim">&gt;</span> {PROMPT}
          <span className="pa-term-from"> · from your phone</span>
        </div>
      </Grow>
      <Collapse open={s.work >= 1} reveal="drop">
        <div>
          <span className="pa-term-dot">⏺</span> The token check compared seconds to milliseconds.
        </div>
      </Collapse>
      <Collapse open={s.work >= 2} reveal="drop">
        <div>
          <span className="pa-term-dot">⏺</span> <span className="pa-term-strong">Update</span>
          (src/auth/session.ts)
        </div>
        <div className="dim">{'  ⎿  2 lines changed'}</div>
      </Collapse>
      <Collapse open={s.ask} reveal="drop">
        <div data-target="term-bash">
          <span className="pa-term-dot">⏺</span> <span className="pa-term-strong">Bash</span>(npm test)
        </div>
        <div className="pa-term-status" data-target="term-status">
          <span className="dim">{'  ⎿'}</span>
          <States
            className="pa-term-mark-cell"
            value={s.passed ? 'tick' : 'spin'}
            states={{
              spin: (
                <span className="pa-spin">
                  <Spinner size={12} />
                </span>
              ),
              tick: <span className="ok">✓</span>,
            }}
          />
          <States
            align="start"
            value={s.passed ? 'passed' : s.run ? 'running' : 'waiting'}
            states={{
              waiting: <span className="pa-term-wait">Waiting for your phone…</span>,
              running: <span className="pa-term-wait">Allowed on your phone. Running…</span>,
              passed: (
                <span>
                  148 passed <span className="dim">in 6.2s</span>
                </span>
              ),
            }}
          />
        </div>
      </Collapse>
      <Collapse open={s.done} reveal="drop">
        <div data-target="term-reply">
          <span className="pa-term-dot pa-term-dot--ok">⏺</span> {REPLY}
        </div>
      </Collapse>
      {/* Where the next line lands: the end of the output, always there to fly to and from */}
      <div data-target="term-next" className="pa-anchor" />
      <div className="pa-term-input">
        <span className="dim">&gt;</span>
      </div>
    </Window>
  );
}

/** The link between the devices: a curve, drawn and left alone. */
const LINK = 'M 560 214 C 625 214, 605 338, 670 338';
const PACKET = {
  msg: { icon: MessageSquare, label: PROMPT },
  ask: { icon: ShieldQuestion, label: 'Run npm test?' },
  ok: { icon: Check, label: 'Allowed' },
  done: { icon: CheckCheck, label: 'All tests pass' },
};
/** The middle of the link, where Pocket Agent relays every message. */
const HUB = { x: 615, y: 276 };

/** The line between the PC and the phone, and the message travelling along it. */
/**
 * Where each message really goes: from the thing that sent it to the place it lands, in a straight
 * flight of its own (the curve is the connection, not the road). The phone sends to the PC; the PC
 * answers the phone.
 */
const ROUTE: Record<S['kind'], [from: string, to: string]> = {
  msg: ['send', 'term-next'],
  ask: ['term-bash', 'phone-next'],
  ok: ['allow', 'term-status'],
  done: ['term-reply', 'phone-next'],
};

/** A point to fly from or to: on the PC, a little in from the line's start; on the phone, its middle. */
function spot(name: string, r: Rect): [number, number] {
  const onPc = name.startsWith('term-');
  return [
    Math.round(onPc ? r.x + Math.min(r.width / 2, 170) : r.x + r.width / 2),
    Math.round(r.y + r.height / 2),
  ];
}

/** The pill's width for each message as it leaves (the label it carries). */
const PILL: Record<S['kind'], number> = { msg: 196, ask: 126, ok: 92, done: 122 };

/**
 * One message in flight. Mounted fresh for each trip (keyed by the packet count), it works out its
 * route once, at take-off: what opens or moves on either screen during the trip never bends it.
 * It leaves as a pill, and on arrival morphs into what it becomes there.
 */
function Packet({ kind }: { kind: S['kind'] }) {
  const { icon: Icon, label } = PACKET[kind];
  const el = useRef<HTMLSpanElement>(null);
  // Measured live, just before the first frame, from the page itself (the stage's own measure can
  // lag behind a room still opening): from what sent it to the real element it becomes, at that
  // element's size. Written straight onto the element; nothing re-renders.
  useLayoutEffect(() => {
    const node = el.current;
    const stage = node?.closest<HTMLElement>('.ss-stage');
    if (!node || !stage) return;
    const st = stage.getBoundingClientRect();
    const k = st.width / stage.offsetWidth;
    const box = (name: string): Rect => {
      const r = stage.querySelector(`[data-target="${name}"]`)?.getBoundingClientRect();
      return r
        ? { x: (r.left - st.left) / k, y: (r.top - st.top) / k, width: r.width / k, height: r.height / k }
        : { x: 0, y: 0, width: 0, height: 0 };
    };
    const [from, to] = ROUTE[kind];
    const [x1, y1] = spot(from, box(from));
    const r = box(to);
    // Where the element will open: on the PC the next line (its start), on the phone the foot of
    // the thread, where it grows up from
    const x2 = to.startsWith('term-') ? r.x + PILL[kind] / 2 + 6 : r.x + r.width / 2;
    const y2 = to.startsWith('term-') ? r.y + r.height / 2 + (to === 'term-next' ? -4 : 0) : r.y - 40;
    node.style.setProperty('offset-path', `path('M ${x1} ${y1} L ${Math.round(x2)} ${Math.round(y2)}')`);
  }, [kind]);
  return (
    <span
      ref={el}
      className="pa-packet"
      data-kind={kind}
      style={
        {
          animationDuration: `${TRIP + HANDOVER}ms`,
        } as React.CSSProperties
      }
      aria-hidden
    >
      <span className="pa-packet__face">
        <Icon size={14} strokeWidth={2.6} />
        {label}
      </span>
    </span>
  );
}

function Link({ s }: { s: S }) {
  return (
    <>
      <svg className="pa-link" width="1000" height="520" aria-hidden>
        <path d={LINK} />
        <circle cx="560" cy="214" r="5" />
        <circle cx="670" cy="338" r="5" />
      </svg>
      <span className="pa-hub" style={{ left: HUB.x, top: HUB.y }} aria-hidden>
        <Image src="/icons/logo-64.png" alt="" width={26} height={26} />
      </span>
      {s.packet > 0 && <Packet key={s.packet} kind={s.kind} />}
    </>
  );
}

/**
 * Room for what a message becomes, opened as the message lands, with its content shown from the
 * first frame (no delayed fade). On the phone it grows up from the foot of the thread, where the
 * message pill landed; in the terminal, down from the line's start.
 */
function Grow({ open, from, children }: { open: boolean; from: 'top' | 'bottom'; children: ReactNode }) {
  return (
    <div className="pa-grow" data-open={open || undefined} data-from={from}>
      <div className="pa-grow__inner">{children}</div>
    </div>
  );
}

/** One step of Claude's turn, as the app draws it: a dot on the left, then the content. */
function Step({
  tone = 'idle',
  children,
  ...rest
}: {
  tone?: 'idle' | 'run' | 'ok';
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement> & { [k: `data-${string}`]: string | undefined }) {
  return (
    <div className="pa-live-step" data-tone={tone} {...rest}>
      {children}
    </div>
  );
}

/** A tool call: its name, then what it worked on, in the app's link blue. */
function ToolRow({ name, target, tone = 'ok' }: { name: string; target: string; tone?: 'run' | 'ok' }) {
  return (
    <Step tone={tone}>
      <div className="pa-live-tool">
        <span className="pa-live-tool-name">{name}</span>
        <span className="pa-live-tool-target">{target}</span>
      </div>
    </Step>
  );
}

/** Your message: the orange bubble, then where it came from, the time and its ticks. */
function Bubble({ children, time }: { children: ReactNode; time: string }) {
  return (
    <div className="pa-live-out">
      <div className="pa-live-bubble">{children}</div>
      <div className="pa-live-meta">
        <Smartphone size={12} strokeWidth={2.2} aria-hidden />
        {time}
        <CheckCheck size={14} strokeWidth={2.2} className="pa-live-ticks" aria-hidden />
      </div>
    </div>
  );
}

/**
 * Pocket Agent's chat screen as the app draws it (apps/mobile/src/features/chat): your messages in
 * orange bubbles, Claude's turn as dotted steps (text, then tool rows with the file in blue), the
 * permission card with Deny and Allow, and the composer with its + and mode chip.
 */
function ChatScreen({ s }: { s: S }) {
  // Claude is busy: from the task's arrival until it asks, and while the tests run
  const working = (s.arrived && !s.ask) || (s.run && !s.done);
  return (
    <div className="pa-app pa-app--chat pa-live">
      <div className="pa-app-thread">
        {/* Earlier in this chat: the crop's edge runs through it */}
        <Bubble time="10:41">Why does sign-in fail after an hour?</Bubble>
        <ToolRow name="Read" target="src/auth/session.ts" />
        <Step>
          The token expiry check compares seconds to <code>Date.now()</code>, which is in milliseconds. Want
          me to fix it?
        </Step>

        <Collapse open={s.sent} reveal="drop" from="below">
          <Bubble time="10:44">{PROMPT}</Bubble>
        </Collapse>
        <Collapse open={s.work >= 1} reveal="drop" from="below">
          <Step>
            <code>expiresAt</code> is in seconds. I&apos;ll compare it in seconds too.
          </Step>
        </Collapse>
        <Collapse open={s.work >= 2} reveal="drop" from="below">
          <ToolRow name="Edit" target="src/auth/session.ts" />
        </Collapse>

        <Grow open={s.roomAsk && !s.closed} from="bottom">
          <div
            className="pa-live-ask pa-morph-in"
            data-morph="card"
            data-target="phone-ask"
            data-allowed={s.allowed || undefined}
          >
            <div className="pa-live-ask-over">
              <span>Permission needed</span>
              <span className="pa-live-ask-left">
                <Clock size={12} strokeWidth={2.4} aria-hidden /> 0:42 left
              </span>
            </div>
            <div className="pa-live-ask-title">Claude wants to run a command</div>
            <div className="pa-live-ask-sub">Command · Bash</div>
            <div className="pa-live-ask-code">npm test</div>
            <div className="pa-live-ask-actions">
              <Button className="pa-live-btn pa-live-btn--deny" variant="secondary" icon={<X size={18} strokeWidth={2.6} />}>
                Deny
              </Button>
              <Button
                className="pa-live-btn pa-live-btn--allow"
                variant="primary"
                data-target="allow"
                icon={<Check size={18} strokeWidth={2.8} />}
              >
                {s.allowed ? 'Allowed' : 'Allow'}
              </Button>
            </div>
          </div>
        </Grow>

        <Collapse open={s.closed} reveal="drop" from="below">
          <Step tone={s.passed ? 'ok' : 'run'}>
            <div className="pa-live-tool">
              <span className="pa-live-tool-name">Bash</span>
            </div>
            <div className="pa-live-io">
              <span className="pa-live-io-label">IN</span>
              <span>npm test</span>
              <span className="pa-live-io-label">OUT</span>
              <States
                align="start"
                className="pa-live-io-out"
                value={s.passed ? 'passed' : 'running'}
                states={{ running: 'Running…', passed: '148 passed in 6.2s' }}
              />
            </div>
          </Step>
        </Collapse>
        <Grow open={s.roomReply} from="bottom">
          <Step data-target="phone-reply" data-morph="text" className="pa-morph-in">
            {REPLY}
          </Step>
        </Grow>
        <Collapse open={working} reveal="drop" from="below">
          <div className="pa-live-working">
            <span className="pa-live-star">✻</span> Churning<span className="pa-live-cursor" />
          </div>
        </Collapse>
      </div>

      <div data-target="phone-next" className="pa-anchor" />
      <div className="pa-composer pa-live-composer">
        <div className="pa-live-box" data-focused={s.typing || undefined}>
          <Field
            className="pa-field pa-live-field"
            value={s.draft}
            placeholder="Message Claude…"
            focused={s.typing}
            box={{ 'data-target': 'composer', 'data-cursor': 'ibeam' }}
          />
          <div className="pa-live-row">
            <span className="pa-live-icon">
              <Plus size={21} strokeWidth={2} aria-hidden />
            </span>
            <span className="pa-live-chip">
              <Zap size={14} strokeWidth={2.2} aria-hidden /> Manual
            </span>
            <span className="pa-live-spacer" />
            <span className="pa-live-icon">
              <Mic size={19} strokeWidth={2} aria-hidden />
            </span>
            <span className="pa-send pa-live-send" data-target="send" data-ready={s.draft ? '' : undefined}>
              <ArrowUp size={18} strokeWidth={2.6} aria-hidden />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HeroDemo() {
  const look = useStageLook();
  return (
    <Stage
      width={1000}
      height={520}
      compact={{ below: 720, width: 358, height: 520 }}
      initial={START}
      poster={POSTER}
      script={script}
      cursor={{ style: 'touch', at: REST }}
      className="pa-hero"
      {...look}
    >
      {(s, _rect, layout) => (
        <>
          {/* Narrow, the phone tells it alone: the task, Allow, the result */}
          {layout === 'wide' && <Terminal s={s} />}
          <Phone
            width={layout === 'compact' ? 310 : 290}
            frame="pro"
            dark={look.theme === 'dark'}
            className="pa-phone"
          >
            <ChatScreen s={s} />
          </Phone>
          {/* Over both devices, so its ends sit on their edges */}
          {layout === 'wide' && <Link s={s} />}
        </>
      )}
    </Stage>
  );
}
