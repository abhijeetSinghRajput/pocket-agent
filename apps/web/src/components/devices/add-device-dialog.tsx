'use client';

import { PAIRING_CODE_TTL_MS } from '@pocket-agent/protocol';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CommandLine } from '@/components/ui/command-line';
import { Modal } from '@/components/ui/dialog';
import { TerminalGuide } from '@/components/ui/terminal-guide';
import { usePairing } from '@/components/devices/use-pairing';
import { AGENT_NPM_PACKAGE, connectCommand } from '@/lib/api';
import { mmss } from '@/lib/format';

export function AddDeviceDialog({
  open,
  onOpenChange,
  knownDeviceIds,
  onPaired,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knownDeviceIds: string[];
  onPaired: () => void;
}) {
  const { step, now, regenerate: createCode } = usePairing({ active: open, knownDeviceIds, onPaired });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={step.kind === 'paired' ? 'Device paired' : 'Pair a device'}
      description={step.kind === 'paired' ? undefined : 'Connect a PC with this one-time code.'}
    >
      {step.kind === 'creating' && (
        <div className="space-y-3" aria-busy="true">
          <div className="mx-auto h-16 w-56 animate-pulse rounded-lg bg-muted" />
          <div className="h-10 animate-pulse rounded-lg bg-muted" />
        </div>
      )}

      {step.kind === 'error' && (
        <div className="space-y-4">
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {step.message}
          </p>
          <Button variant="outline" onClick={() => void createCode()}>
            <RefreshCw aria-hidden /> Try again
          </Button>
        </div>
      )}

      {step.kind === 'code' && (
        <div className="flex flex-col gap-5">
          {/* The one line to run, whole: copying it is all it takes. */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Run this in a terminal on your PC:</p>
            <CommandLine command={connectCommand(step.code)} />
            <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              Code{' '}
              <span data-testid="pairing-code" className="font-mono font-semibold text-foreground">
                {step.code}
              </span>{' '}
              · single use · expires in {mmss(Math.min(step.expiresAt - now, PAIRING_CODE_TTL_MS))}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">First time on this PC? Install it, then connect:</p>
            <TerminalGuide
              steps={[
                { command: `npm install -g ${AGENT_NPM_PACKAGE}` },
                {
                  command: connectCommand(step.code),
                  output: 'Your PC is connected! Open Pocket Agent on your phone.',
                },
              ]}
            />
            <p className="text-xs text-muted-foreground">Needs Node.js 24+.</p>
          </div>

          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-muted border-t-primary"
              aria-hidden
            />
            Waiting for your PC…
          </p>
        </div>
      )}

      {step.kind === 'expired' && (
        <div className="flex flex-col items-start gap-4">
          <p className="text-sm text-muted-foreground">
            This code expired before it was used. Codes last 10 minutes.
          </p>
          <Button onClick={() => void createCode()}>
            <RefreshCw aria-hidden /> Generate a new code
          </Button>
        </div>
      )}

      {step.kind === 'paired' && (
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            <p className="text-sm">
              <span className="font-medium">{step.device.name}</span>{' '}
              {step.device.status === 'Online'
                ? 'is connected and online.'
                : 'is paired. It shows as Online in a moment.'}
            </p>
          </div>
          <Button onClick={() => onOpenChange(false)} className="self-end">
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}
