'use client';

import { PAIRING_CODE_TTL_MS } from '@pocket-agent/protocol';
import { Check, Clock, Hash, QrCode, RefreshCw, ScanLine, Share2 } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { PairScanner } from '@/components/devices/pair-scanner';
import type { PairingStep } from '@/components/devices/use-pairing';
import { Button } from '@/components/ui/button';
import { CopyMark, useCopy } from '@/components/ui/copy-button';
import { Notice } from '@/components/ui/notice';
import { followStyle, useFollow } from '@/components/ui/segmented';
import { AGENT_NPM_PACKAGE, connectCommand, installCommand } from '@/lib/api';
import { mmss } from '@/lib/format';
import { cn } from '@/lib/utils';

/** How the PC gets paired: its QR code scanned by a phone, or a code typed on the PC. */
export type ConnectMode = 'scan' | 'code';

const MODES = [
  { value: 'scan' as const, label: 'Scan QR', icon: ScanLine },
  { value: 'code' as const, label: 'Use code', icon: Hash },
];

/** The surface commands sit on: the app's code colour in dark, a light wash in light. */
const WELL = 'border bg-background/60 dark:bg-[#141414]';

/** A phone (touch-first screen): the scan step then speaks of "this phone". */
function subscribeCoarse(onChange: () => void) {
  const mq = window.matchMedia('(pointer: coarse)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
function useIsPhone() {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia('(pointer: coarse)').matches,
    () => false,
  );
}

/** The two ways, as the app's large, accent-filled switch (it changes everything under it). */
function ModeSwitch({ value, onChange }: { value: ConnectMode; onChange: (m: ConnectMode) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const { rect, last, moving } = useFollow(box, '[data-selected="true"]', value);
  return (
    <div
      ref={box}
      role="tablist"
      aria-label="How to connect"
      data-testid="connect-mode"
      className="relative flex h-[52px] rounded-[14px] border bg-background p-0.5"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 rounded-[13px] bg-primary shadow-sm"
        style={followStyle(rect, moving, last)}
      />
      {MODES.map(({ value: v, label, icon: Icon }) => {
        const selected = v === value;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={selected}
            data-selected={selected}
            data-sound={selected ? 'none' : 'select'}
            onClick={() => onChange(v)}
            className={cn(
              'relative z-10 flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[13px] text-[15px] outline-none transition-colors duration-200 focus-visible:ring-[3px] focus-visible:ring-ring/50',
              selected
                ? 'font-semibold text-primary-foreground'
                : 'font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-[17px] shrink-0" strokeWidth={2.1} aria-hidden />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The step's number in a small circle; green with a tick once done. */
function StepNumber({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold transition-colors duration-300 ease-(--ease-out)',
        done ? 'bg-success text-white' : 'bg-muted text-foreground',
      )}
    >
      {done ? (
        <Check key="done" className="size-[15px] animate-in zoom-in-50 fade-in-0" strokeWidth={3} />
      ) : (
        <span key="n" className="animate-in fade-in-0">
          {n}
        </span>
      )}
    </span>
  );
}

function Step({
  n,
  title,
  done = false,
  aside,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  /** Small note at the end of the title row (e.g. "Node 24+"). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3.5 p-4">
      <div className="flex items-center gap-3">
        <StepNumber n={n} done={done} />
        <h3 className="min-w-0 flex-1 truncate text-base leading-[22px] font-semibold">
          <span className="sr-only">
            Step {n}
            {done ? ' (done)' : ''}:{' '}
          </span>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center rounded-full border px-[9px] text-[12.5px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

/**
 * A command to run, drawn as a small terminal: a "Terminal" bar with Copy, then the command.
 * `accent` is the word shown in the brand colour. An expired command is grey and its code struck out.
 */
function TerminalBox({
  command,
  accent,
  expired,
  testId,
}: {
  command: string;
  accent: string;
  expired?: boolean;
  testId?: string;
}) {
  const [copied, copy] = useCopy(command);
  const [program = '', ...rest] = command.split(' ');
  return (
    <div className={cn('overflow-hidden rounded-[14px]', WELL)}>
      <div className="flex h-10 items-center justify-between pr-1.5 pl-3.5">
        <span className="text-xs leading-4 font-semibold tracking-[1.6px] text-muted-foreground uppercase">
          Terminal
        </span>
        {expired ? (
          <span className="mr-2 inline-flex h-[22px] items-center rounded-full bg-muted px-2.5 text-[12.5px] font-medium text-muted-foreground animate-in fade-in-0">
            Expired
          </span>
        ) : (
          <button
            type="button"
            onClick={copy}
            data-sound="copy"
            aria-label={copied ? 'Copied' : `Copy: ${command}`}
            className="flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.92]"
          >
            <CopyMark copied={copied} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <code
        className={cn(
          'block px-3.5 pt-0.5 pb-3.5 font-mono text-[13.5px] leading-5 wrap-anywhere',
          expired && 'select-none',
        )}
        data-testid={testId}
      >
        <span className={cn('font-medium', expired ? 'text-muted-foreground' : 'text-foreground')}>
          {program}
        </span>
        {rest.map((word, i) => (
          <span key={i}>
            {' '}
            <span
              data-testid={word === accent && testId === 'pairing-command' ? 'pairing-code' : undefined}
              className={
                word === accent
                  ? expired
                    ? 'text-muted-foreground line-through'
                    : 'font-medium text-primary'
                  : 'text-muted-foreground'
              }
            >
              {word}
            </span>
          </span>
        ))}
      </code>
    </div>
  );
}

/** A countdown: shrinks steadily, one linear step per second, from the left. */
function CountdownBar({ fraction }: { fraction: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div
        className="countdown-bar h-full w-full rounded-full bg-primary"
        style={{ transform: `scaleX(${fraction})` }}
      />
    </div>
  );
}

/** A viewfinder (brackets in the corners) around a QR glyph: clicking it opens the scanner too. */
function Viewfinder({ onPress }: { onPress: () => void }) {
  const corner = 'absolute size-[22px] border-primary';
  return (
    <button
      type="button"
      aria-label="Open scanner"
      onClick={onPress}
      className={cn(
        'grid h-32 place-items-center rounded-[14px] outline-none transition-transform active:scale-[0.98] focus-visible:ring-[3px] focus-visible:ring-ring/50',
        WELL,
      )}
    >
      <span className="relative grid size-[88px] place-items-center" aria-hidden>
        <span className={cn(corner, 'top-0 left-0 rounded-tl-[10px] border-t-[3px] border-l-[3px]')} />
        <span className={cn(corner, 'top-0 right-0 rounded-tr-[10px] border-t-[3px] border-r-[3px]')} />
        <span className={cn(corner, 'bottom-0 left-0 rounded-bl-[10px] border-b-[3px] border-l-[3px]')} />
        <span className={cn(corner, 'right-0 bottom-0 rounded-br-[10px] border-r-[3px] border-b-[3px]')} />
        <QrCode className="size-11 text-foreground" strokeWidth={1.8} />
      </span>
    </button>
  );
}

/**
 * How to pair a PC, either way: "Scan QR" (run connect, scan the PC's QR code with a phone) or
 * "Use code" (run connect with a short code, counting down; once it expires it is struck out and a
 * button gets a new one). Shared by the onboarding screen and the Add device sheet. Without
 * `onModeChange` there is no switch and it shows the code way (`footer` then sits under the steps).
 */
export function ConnectSteps({
  step,
  now,
  regenerate,
  mode = 'code',
  onModeChange,
  footer,
}: {
  step: PairingStep;
  now: number;
  regenerate: () => void;
  mode?: ConnectMode;
  onModeChange?: (mode: ConnectMode) => void;
  /** Shown under the steps while waiting (live status). */
  footer?: ReactNode;
}) {
  const phone = useIsPhone();
  const [scanning, setScanning] = useState(false);
  const paired = step.kind === 'paired';
  const expired = step.kind === 'expired';
  const left = step.kind === 'code' ? Math.max(0, Math.min(step.expiresAt - now, PAIRING_CODE_TTL_MS)) : 0;
  const code = step.kind === 'code' || step.kind === 'expired' ? step.code : '';

  return (
    <div className="flex flex-col gap-4">
      {onModeChange && <ModeSwitch value={mode} onChange={onModeChange} />}
      <div
        data-testid="connect-steps"
        className="divide-y overflow-hidden rounded-3xl border bg-card dark:border-transparent"
      >
        <Step n={1} title="Install Pocket Agent" done={paired} aside={<Chip label="Node 24+" />}>
          <TerminalBox command={installCommand()} accent={AGENT_NPM_PACKAGE} testId="install-command" />
        </Step>

        {paired ? (
          <div key="paired" className="animate-in fade-in-0 duration-300">
            <Step n={2} title="Connect this PC" done>
              <p className="text-sm">
                <span className="font-medium">{step.device.name}</span> is paired. Finishing setup on the PC…
              </p>
            </Step>
          </div>
        ) : mode === 'scan' ? (
          <div key="scan" className="divide-y animate-in fade-in-0 duration-300">
            <Step n={2} title="Run on your PC">
              <TerminalBox command={connectCommand()} accent="connect" testId="scan-command" />
            </Step>
            <Step n={3} title={phone ? 'Scan with this phone' : 'Scan with your phone'}>
              <Viewfinder onPress={() => setScanning(true)} />
              <Button
                className="h-[52px] w-full rounded-[18px] text-base font-semibold [&_svg]:size-[19px]"
                onClick={() => setScanning(true)}
                data-testid="scan-pc"
              >
                <ScanLine aria-hidden /> Open scanner
              </Button>
            </Step>
          </div>
        ) : (
          <div key="code" className="animate-in fade-in-0 duration-300">
            <Step n={2} title="Your pairing code">
              {step.kind === 'creating' && <div className="h-[86px] animate-pulse rounded-[14px] bg-muted" />}
              {step.kind === 'error' && (
                <div className="flex flex-col items-start gap-3">
                  <Notice>{step.message}</Notice>
                  <Button variant="outline" size="sm" onClick={regenerate}>
                    <RefreshCw aria-hidden /> Try again
                  </Button>
                </div>
              )}
              {(step.kind === 'code' || expired) && (
                <div className="flex flex-col gap-3.5">
                  <TerminalBox
                    command={connectCommand(code)}
                    accent={code}
                    expired={expired}
                    testId="pairing-command"
                  />
                  <div className="flex min-h-8 items-center justify-between gap-3 text-sm text-muted-foreground">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Clock className="size-[15px] shrink-0" aria-hidden /> Single use
                    </span>
                    {expired ? (
                      <Button
                        size="sm"
                        className="h-9 rounded-[10px] animate-in zoom-in-90 fade-in-0"
                        onClick={regenerate}
                        data-testid="new-code"
                      >
                        <RefreshCw aria-hidden /> New code
                      </Button>
                    ) : (
                      <span className="tabular-nums" aria-live="polite">
                        Expires in <span className="font-semibold text-foreground">{mmss(left)}</span>
                      </span>
                    )}
                  </div>
                  {!expired && <CountdownBar fraction={left / PAIRING_CODE_TTL_MS} />}
                </div>
              )}
            </Step>
          </div>
        )}

        {footer && !expired && <div className="px-4 py-4">{footer}</div>}
      </div>
      <PairScanner open={scanning} onClose={() => setScanning(false)} />
    </div>
  );
}

/** The commands as one text, for sending to the PC (shared, or copied where sharing isn't offered). */
function commandsText(code: string | null) {
  return code
    ? `Connect your PC to Pocket Agent (run in a terminal):\n\n${installCommand()}\n${connectCommand(code)}\n\nThe code is single use and expires in ${PAIRING_CODE_TTL_MS / 60_000} minutes.`
    : `Connect your PC to Pocket Agent (run in a terminal):\n\n${installCommand()}\n${connectCommand()}\n\nThen scan the QR code it shows with the Pocket Agent app.`;
}

/**
 * The live status under the steps: waiting (a pulsing dot) or the PC found, and Share for sending
 * the commands to the PC.
 */
export function ConnectStatus({ step, mode }: { step: PairingStep; mode: ConnectMode }) {
  const paired = step.kind === 'paired';
  const code = mode === 'code' && step.kind === 'code' ? step.code : null;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  function share() {
    const text = commandsText(code);
    if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
      void navigator.share({ title: 'Connect your PC to Pocket Agent', text }).catch(() => undefined);
    } else {
      void navigator.clipboard?.writeText(text).then(() => setCopied(true));
    }
  }

  return (
    <div
      data-testid="onboarding-status"
      className="flex h-[60px] items-center gap-3 rounded-[18px] border bg-card pr-2 pl-4 dark:border-transparent"
    >
      <span
        aria-hidden
        className={cn('size-[7px] shrink-0 rounded-full', paired ? 'bg-success' : 'animate-pulse bg-primary')}
      />
      <p
        key={paired ? 'found' : 'waiting'}
        aria-live="polite"
        className="min-w-0 flex-1 truncate text-sm animate-in fade-in-0 duration-300"
      >
        {paired ? (
          <>
            <span className="font-medium">{step.device.name}</span> found. Connecting…
          </>
        ) : (
          <span className="text-muted-foreground">Waiting for your PC…</span>
        )}
      </p>
      {!paired && (
        <Button
          variant="secondary"
          size="sm"
          className="h-9 rounded-[10px]"
          onClick={share}
          data-testid="share-commands"
        >
          {copied ? <CopyMark copied /> : <Share2 aria-hidden />}
          {copied ? 'Copied' : 'Share'}
        </Button>
      )}
    </div>
  );
}
