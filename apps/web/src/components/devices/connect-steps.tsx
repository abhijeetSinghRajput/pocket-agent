'use client';

import { PAIRING_CODE_TTL_MS } from '@pocket-agent/protocol';
import { Check, Clock, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PairingStep } from '@/components/devices/use-pairing';
import { Button } from '@/components/ui/button';
import { CopyMark, useCopy } from '@/components/ui/copy-button';
import { AGENT_NPM_PACKAGE, connectCommand, installCommand } from '@/lib/api';
import { mmss } from '@/lib/format';
import { cn } from '@/lib/utils';

function StepNumber({ n, state }: { n: number; state: 'todo' | 'current' | 'done' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold transition-colors duration-300',
        state === 'done' && 'bg-success text-white',
        state === 'current' && 'bg-primary text-primary-foreground',
        state === 'todo' && 'border-2 border-border text-muted-foreground',
      )}
    >
      {state === 'done' ? <Check className="size-4" strokeWidth={3} /> : n}
    </span>
  );
}

function Step({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: 'todo' | 'current' | 'done';
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 p-5 sm:p-6">
      <h3 className="flex items-center gap-3.5 text-lg font-semibold">
        <StepNumber n={n} state={state} />
        <span>
          <span className="sr-only">
            Step {n}
            {state === 'done' ? ' (done)' : ''}:{' '}
          </span>
          {title}
        </span>
      </h3>
      {children}
    </div>
  );
}

/**
 * A command to run, drawn as a small terminal: a "Terminal" bar with Copy, then the command.
 * `accent` is the part shown in the brand colour (the package, the pairing code).
 */
function TerminalBox({ command, accent, expired }: { command: string; accent: string; expired?: boolean }) {
  const [copied, copy] = useCopy(command);
  const [program = '', ...rest] = command.split(' ');
  return (
    <div className="overflow-hidden rounded-xl border bg-background/60">
      <div className="flex h-11 items-center justify-between border-b px-4">
        <span className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Terminal
        </span>
        {expired ? (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            Expired
          </span>
        ) : (
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? 'Copied' : `Copy: ${command}`}
            className="-mr-2 flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <CopyMark copied={copied} className="size-4" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <code
        className={cn(
          'block px-4 py-3.5 font-mono text-[13.5px] leading-relaxed [overflow-wrap:anywhere]',
          expired && 'text-muted-foreground line-through',
        )}
        data-testid={accent === AGENT_NPM_PACKAGE ? 'install-command' : 'pairing-command'}
      >
        {expired ? (
          command
        ) : (
          <>
            <span className="font-semibold">{program}</span>{' '}
            {rest.map((word, i) => (
              <span
                key={i}
                className={word === accent ? 'font-medium text-primary' : 'text-muted-foreground'}
              >
                {word}
                {i < rest.length - 1 ? ' ' : ''}
              </span>
            ))}
          </>
        )}
      </code>
    </div>
  );
}

/**
 * The two things to run on a PC: install once, then connect with this code (counting down, and
 * replaced in place once it expires). Shared by the onboarding screen and the Add device dialog.
 */
export function ConnectSteps({
  step,
  now,
  regenerate,
  footer,
}: {
  step: PairingStep;
  now: number;
  regenerate: () => void;
  /** Shown under the steps while waiting (live status). */
  footer?: ReactNode;
}) {
  const paired = step.kind === 'paired';
  const expired = step.kind === 'expired';
  const left = step.kind === 'code' ? Math.max(0, Math.min(step.expiresAt - now, PAIRING_CODE_TTL_MS)) : 0;
  const code = step.kind === 'code' || step.kind === 'expired' ? step.code : '';

  return (
    <div
      className="divide-y overflow-hidden rounded-2xl border bg-card shadow-xs"
      data-testid="connect-steps"
    >
      <Step n={1} title="Install Pocket Agent" state={paired ? 'done' : 'current'}>
        <TerminalBox command={installCommand()} accent={AGENT_NPM_PACKAGE} />
        <p className="text-sm text-muted-foreground">
          Needs Node.js 24 or newer. Already installed? Skip this step.
        </p>
      </Step>

      <Step n={2} title="Connect this PC" state={paired ? 'done' : 'current'}>
        {step.kind === 'creating' && <div className="h-[100px] animate-pulse rounded-xl bg-muted" />}
        {step.kind === 'error' && (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {step.message}
            </p>
            <Button variant="outline" size="sm" onClick={regenerate}>
              <RefreshCw aria-hidden /> Try again
            </Button>
          </div>
        )}
        {(step.kind === 'code' || expired) && (
          <>
            <TerminalBox command={connectCommand(code)} accent={code} expired={expired} />
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span>
                  Code{' '}
                  <span data-testid="pairing-code" className="font-mono font-semibold text-foreground">
                    {code}
                  </span>{' '}
                  · single use
                </span>
                <span className="flex shrink-0 items-center gap-1.5 tabular-nums" aria-live="polite">
                  <Clock className="size-4" aria-hidden />
                  {expired ? (
                    'Expired'
                  ) : (
                    <>
                      Expires in <span className="font-semibold text-foreground">{mmss(left)}</span>
                    </>
                  )}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className="countdown-bar h-full rounded-full bg-primary"
                  style={{ transform: `scaleX(${left / PAIRING_CODE_TTL_MS})` }}
                />
              </div>
            </div>
          </>
        )}
        {paired && (
          <p className="text-sm">
            <span className="font-medium">{step.device.name}</span> used the code. Finishing setup on the PC…
          </p>
        )}
      </Step>

      {expired && (
        <div className="flex flex-col gap-4 p-5 sm:p-6" data-testid="code-expired">
          <div>
            <p className="text-lg font-semibold">This code has expired</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Get a new code, then run the new connect command.
            </p>
          </div>
          <Button size="lg" className="h-12 w-full rounded-xl text-[15px]" onClick={regenerate}>
            <RefreshCw aria-hidden /> Get a new code
          </Button>
        </div>
      )}

      {footer && !expired && <div className="px-5 py-4 sm:px-6">{footer}</div>}
    </div>
  );
}
