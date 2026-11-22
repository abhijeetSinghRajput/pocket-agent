'use client';

import type { DeviceDto, UserDto } from '@pocket-agent/protocol';
import { ArrowLeft, Download, KeyRound, LogOut, Monitor, Moon, Plus, Sun, Zap } from 'lucide-react';
import Image from 'next/image';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { ConnectSteps } from '@/components/devices/connect-steps';
import { usePairing } from '@/components/devices/use-pairing';
import { useSmoothTheme } from '@/components/theme';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/user-avatar';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

const STEPS = [
  { icon: Download, title: 'Install Pocket Agent', text: 'Run a single command on your Windows PC.' },
  {
    icon: KeyRound,
    title: 'Pair your device',
    text: 'Connect it with a one-time code from this app.',
  },
  { icon: Zap, title: 'You’re ready!', text: 'Follow and steer your Claude sessions from anywhere.' },
];

/** Account menu: theme and sign out (the only ways out of this screen). */
function AccountMenu({ user }: { user: UserDto }) {
  const { logout } = useAuth();
  const { resolvedTheme, setTheme } = useSmoothTheme();
  const dark = resolvedTheme === 'dark';
  const item =
    'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-[highlighted]:bg-accent';
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label="Account"
        data-testid="onboarding-account"
        className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <UserAvatar user={user} className="size-10" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-56 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={item} onSelect={() => setTheme(dark ? 'light' : 'dark')}>
            {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
            {dark ? 'Light theme' : 'Dark theme'}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={cn(item, 'text-destructive')}
            onSelect={() => void logout()}
            data-testid="onboarding-sign-out"
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Header({ user }: { user: UserDto | null }) {
  return (
    <header className="mx-auto flex w-full max-w-lg items-center justify-between gap-3 px-5 pt-5 pb-4">
      <div className="flex min-w-0 items-center gap-3">
        <Image src="/icons/logo-64.png" alt="" width={44} height={44} priority className="size-11" />
        <div className="min-w-0">
          <p className="text-lg leading-tight font-semibold tracking-tight">Pocket Agent</p>
          <p className="truncate text-sm text-muted-foreground">Your PC, in your pocket.</p>
        </div>
      </div>
      {user && <AccountMenu user={user} />}
    </header>
  );
}

/** Page 1: who this is for, the one button, and how it works. */
function Welcome({ firstName, onStart }: { firstName: string | undefined; onStart: () => void }) {
  return (
    <div className="stagger">
      <div className="border-t pt-8">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">Welcome aboard</p>
        <h1 className="mt-2 text-3xl leading-tight font-bold tracking-tight text-balance">
          {firstName ? `Hey, ${firstName}` : 'Hey there'}{' '}
          <span aria-hidden className="inline-block">
            👋
          </span>
          <span className="mt-1 block text-2xl font-semibold">Let’s connect your PC.</span>
        </h1>
        <p className="mt-3 text-[15px] text-pretty text-muted-foreground">
          Set up Pocket Agent once and follow and steer Claude on your computer right from your phone.
        </p>
      </div>

      <section
        aria-labelledby="devices-heading"
        className="mt-8 rounded-2xl border bg-card p-5 shadow-xs sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="devices-heading" className="text-lg font-semibold">
            Your devices
          </h2>
          <span
            className="rounded-full bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary"
            data-testid="onboarding-status"
          >
            Not connected
          </span>
        </div>
        <div className="flex flex-col items-center pt-6 text-center">
          <span className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Monitor className="size-7" aria-hidden />
          </span>
          <p className="mt-4 text-lg font-semibold">No PC connected yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Your connected computers will appear here.</p>
          <Button
            size="lg"
            className="mt-6 h-12 w-full rounded-xl text-[15px]"
            onClick={onStart}
            data-testid="onboarding-connect"
          >
            <Plus aria-hidden /> Connect your PC
          </Button>
          <p className="mt-3 text-xs text-primary">Takes about 2 minutes · One-time setup</p>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-lg font-semibold">
          How it works
        </h2>
        <ol className="mt-5 flex flex-col gap-5">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="flex items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="font-semibold">
                  {String(i + 1).padStart(2, '0')}. {title}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** The PC is online: a big tick that draws itself, then the way into the app. */
function Connected({ device, onDone }: { device: DeviceDto; onDone: () => void }) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center px-6 text-center"
      data-testid="onboarding-connected"
    >
      <div className="relative grid size-32 place-items-center">
        <span aria-hidden className="success-ring absolute inset-0 rounded-full bg-success/30" />
        <span className="success-badge relative grid size-32 place-items-center rounded-full bg-success text-white shadow-[0_18px_50px_-12px_var(--success)]">
          <svg viewBox="0 0 24 24" className="size-16" fill="none" aria-hidden>
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              pathLength={1}
              className="success-tick"
              stroke="currentColor"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
      <h1 className="rise-in mt-9 text-3xl font-bold tracking-tight" style={{ animationDelay: '420ms' }}>
        Your PC is connected!
      </h1>
      <p
        className="rise-in mt-3 max-w-xs text-[15px] text-muted-foreground"
        style={{ animationDelay: '480ms' }}
      >
        <span className="font-medium text-foreground">{device.name}</span> is online. Pocket Agent runs in the
        background on it.
      </p>
      <div className="rise-in mt-10 w-full max-w-sm" style={{ animationDelay: '560ms' }}>
        <Button size="lg" className="h-12 w-full rounded-xl text-[15px]" onClick={onDone} autoFocus>
          Set up your workspace
        </Button>
      </div>
    </div>
  );
}

/**
 * The first screen for an account without a PC; it can't be skipped (nothing works without one),
 * the account menu still offers sign out. Page 1 explains and has the one button; page 2 has the
 * two commands and follows the PC live; once the PC is online, the success screen.
 */
export function Onboarding({ knownDeviceIds, onDone }: { knownDeviceIds: string[]; onDone: () => void }) {
  const { state } = useAuth();
  const user = state.status === 'authenticated' ? state.user : null;
  const firstName = user?.name.trim().split(/\s+/)[0];
  const [started, setStarted] = useState(false);
  const { step, now, regenerate } = usePairing({ active: started, knownDeviceIds });
  const paired = started && step.kind === 'paired';

  if (paired && step.device.status === 'Online') return <Connected device={step.device} onDone={onDone} />;

  return (
    <div className="flex min-h-dvh flex-col">
      <Header user={user} />
      <main className="mx-auto w-full max-w-lg flex-1 px-5 pb-12">
        {!started ? (
          <Welcome firstName={firstName} onStart={() => setStarted(true)} />
        ) : (
          <div className="content-in border-t pt-6">
            {!paired && (
              <button
                type="button"
                onClick={() => setStarted(false)}
                className="-ml-2 flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <ArrowLeft className="size-4" aria-hidden /> Back
              </button>
            )}
            <h1 className="mt-3 text-2xl font-bold tracking-tight">Connect your PC</h1>
            <p className="mt-1.5 text-[15px] text-muted-foreground">
              Run these in PowerShell on your Windows PC. This page updates by itself.
            </p>
            <div className="mt-6">
              <ConnectSteps
                step={step}
                now={now}
                regenerate={() => void regenerate()}
                footer={
                  <p
                    className="flex items-center gap-3 text-sm"
                    aria-live="polite"
                    data-testid="onboarding-status"
                  >
                    <span
                      className="size-4 shrink-0 animate-spin rounded-full border-2 border-muted border-t-primary"
                      aria-hidden
                    />
                    {paired ? (
                      <span>
                        <span className="font-medium">{step.device.name}</span> found. Connecting…
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Waiting for your PC…</span>
                    )}
                  </p>
                }
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
