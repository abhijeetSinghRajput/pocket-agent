'use client';

import { PAIRING_CODE_TTL_MS, type DeviceDto } from '@pocket-agent/protocol';
import { Check, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '@/components/app-shell';
import { usePairing } from '@/components/devices/use-pairing';
import { ThemeToggle } from '@/components/theme';
import { Button } from '@/components/ui/button';
import { CommandLine } from '@/components/ui/command-line';
import { AGENT_NPM_PACKAGE, connectCommand } from '@/lib/api';
import { mmss } from '@/lib/format';
import { cn } from '@/lib/utils';

/** What `pocket-agent connect` takes care of, so the user never has to. */
const HANDLED = [
  'Pairs this PC with your account',
  'Links Claude Code on this PC',
  'Runs quietly in the background',
  'Starts again when you sign in to Windows',
];

function StepMarker({ n, done, current }: { n: number; done: boolean; current: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold transition-colors duration-300',
        done
          ? 'bg-success text-white'
          : current
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {done ? <Check className="size-4" strokeWidth={3} /> : n}
    </span>
  );
}

function Step({
  n,
  title,
  done,
  current,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3.5">
      <StepMarker n={n} done={done} current={current} />
      <div className="min-w-0 flex-1 pt-0.5">
        <h2 className="text-[15px] font-semibold">
          <span className="sr-only">
            Step {n}
            {done ? ' (done)' : ''}:{' '}
          </span>
          {title}
        </h2>
        <div className="mt-2.5 flex flex-col gap-2">{children}</div>
      </div>
    </li>
  );
}

function Connected({ device, onDone }: { device: DeviceDto; onDone: () => void }) {
  return (
    <div className="flex flex-col items-center py-6 text-center" data-testid="onboarding-connected">
      <span className="grid size-16 place-items-center rounded-full bg-success/15 text-success">
        <Check className="size-8" strokeWidth={2.5} aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-balance">Your PC is connected!</h1>
      <p className="mt-2 max-w-sm text-sm text-pretty text-muted-foreground">
        <span className="font-medium text-foreground">{device.name}</span> is online. Pocket Agent runs in the
        background on it, so you can follow and steer Claude from here.
      </p>
      <Button size="lg" className="mt-7" onClick={onDone} autoFocus>
        Start using Pocket Agent
      </Button>
    </div>
  );
}

/**
 * First screen after sign-in when no PC is connected yet: two commands to run on the PC, with a
 * live status that turns green only once the server actually sees the PC online.
 */
export function Onboarding({
  knownDeviceIds,
  onDone,
  onSkip,
}: {
  knownDeviceIds: string[];
  onDone: () => void;
  onSkip: () => void;
}) {
  const { step, now, regenerate } = usePairing({ active: true, knownDeviceIds });
  const paired = step.kind === 'paired';
  const online = paired && step.device.status === 'Online';

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1">
          {!online && (
            <Button variant="ghost" size="sm" onClick={onSkip} data-testid="onboarding-skip">
              Set up later
            </Button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 justify-center px-4 pt-[4vh] pb-12 sm:pt-[8vh]">
        <div className="w-full max-w-lg">
          {online ? (
            <Connected device={step.device} onDone={onDone} />
          ) : (
            <>
              <h1 className="text-2xl font-semibold tracking-tight text-balance">Connect your PC</h1>
              <p className="mt-2 text-sm text-pretty text-muted-foreground">
                Run two commands in a terminal on your computer. Pocket Agent sets up everything else.
              </p>

              <ol className="mt-8 flex flex-col gap-7" aria-label="Setup steps">
                <Step n={1} title="Install Pocket Agent" done={paired} current={!paired}>
                  <CommandLine command={`npm install -g ${AGENT_NPM_PACKAGE}`} />
                  <p className="text-xs text-muted-foreground">
                    Needs Node.js 24 or newer. Already installed? Go to step 2.
                  </p>
                </Step>

                <Step n={2} title="Connect this PC" done={paired} current={!paired}>
                  {step.kind === 'creating' && (
                    <div className="h-11 animate-pulse rounded-lg bg-muted" aria-busy="true" />
                  )}
                  {step.kind === 'error' && (
                    <div role="alert" className="flex flex-col items-start gap-3">
                      <p className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                        {step.message}
                      </p>
                      <Button variant="outline" size="sm" onClick={() => void regenerate()}>
                        <RefreshCw aria-hidden /> Try again
                      </Button>
                    </div>
                  )}
                  {step.kind === 'expired' && (
                    <div className="flex flex-col items-start gap-3">
                      <p className="text-sm text-muted-foreground">
                        This code expired before it was used. Codes last 10 minutes.
                      </p>
                      <Button size="sm" onClick={() => void regenerate()}>
                        <RefreshCw aria-hidden /> New code
                      </Button>
                    </div>
                  )}
                  {step.kind === 'code' && (
                    <>
                      <CommandLine command={connectCommand(step.code)} />
                      <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                        Code{' '}
                        <span data-testid="pairing-code" className="font-mono font-semibold text-foreground">
                          {step.code}
                        </span>{' '}
                        · single use · expires in {mmss(Math.min(step.expiresAt - now, PAIRING_CODE_TTL_MS))}
                      </p>
                    </>
                  )}
                  {paired && <p className="text-sm text-muted-foreground">Code used. Nothing else to run.</p>}
                </Step>
              </ol>

              {/* Live status: waiting → paired, finishing → (connected screen). */}
              <div
                className="mt-8 flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5"
                aria-live="polite"
                data-testid="onboarding-status"
              >
                <span
                  className="size-4 shrink-0 animate-spin rounded-full border-2 border-muted border-t-primary"
                  aria-hidden
                />
                <p className="text-sm">
                  {paired ? (
                    <>
                      <span className="font-medium">{step.device.name}</span> is paired. Finishing setup…
                    </>
                  ) : (
                    <span className="text-muted-foreground">Waiting for your PC…</span>
                  )}
                </p>
              </div>

              <section className="mt-8" aria-labelledby="onboarding-handled">
                <h2 id="onboarding-handled" className="text-xs font-medium text-muted-foreground">
                  The connect command takes care of
                </h2>
                <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
                  {HANDLED.map((h) => (
                    <li key={h} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      {h}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-pretty text-muted-foreground">
                  Pocket Agent only connects outward from your PC; nothing on it is opened to the internet.
                  Something not working? Run{' '}
                  <code className="font-mono whitespace-nowrap">pocket-agent doctor</code> on the PC.
                </p>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
