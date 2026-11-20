'use client';

import {
  DeviceListResponse,
  PAIRING_CODE_TTL_MS,
  PairingCodeResponse,
  type DeviceDto,
} from '@pocket-agent/protocol';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CommandLine } from '@/components/ui/command-line';
import { CopyButton } from '@/components/ui/copy-button';
import { Modal } from '@/components/ui/dialog';
import { agentApiUrl, AGENT_NPM_PACKAGE, apiRequest } from '@/lib/api';
import { mmss } from '@/lib/format';

type Step =
  | { kind: 'creating' }
  | { kind: 'code'; code: string; expiresAt: number }
  | { kind: 'expired' }
  | { kind: 'paired'; device: DeviceDto }
  | { kind: 'error'; message: string };

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
  const [step, setStep] = useState<Step>({ kind: 'creating' });
  const [now, setNow] = useState(() => Date.now());
  const known = useRef(new Set<string>());

  const createCode = useCallback(async () => {
    setStep({ kind: 'creating' });
    try {
      const res = await apiRequest('/devices/pairing-codes', PairingCodeResponse, { method: 'POST' });
      setStep({ kind: 'code', code: res.code, expiresAt: Date.parse(res.expiresAt) });
    } catch (err) {
      setStep({ kind: 'error', message: (err as Error).message });
    }
  }, []);

  // New code each time the dialog opens; remember which devices already existed.
  useEffect(() => {
    if (!open) return;
    known.current = new Set(knownDeviceIds);
    const id = setTimeout(() => void createCode(), 0);
    return () => clearTimeout(id);
    // knownDeviceIds intentionally read only at open time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, createCode]);

  // While a code is showing: tick the countdown and watch for the new device.
  useEffect(() => {
    if (!open || step.kind !== 'code') return;
    const tick = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= step.expiresAt) setStep({ kind: 'expired' });
    }, 1000);
    const watch = setInterval(async () => {
      try {
        const { devices } = await apiRequest('/devices', DeviceListResponse);
        const fresh = devices.find((d) => !known.current.has(d.id) && d.status !== 'Revoked');
        if (fresh) {
          setStep({ kind: 'paired', device: fresh });
          onPaired();
        }
      } catch {
        /* keep waiting; transient errors are fine here */
      }
    }, 2000);
    return () => {
      clearInterval(tick);
      clearInterval(watch);
    };
  }, [open, step, onPaired]);

  const api = agentApiUrl();

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={step.kind === 'paired' ? 'Device paired' : 'Pair a device'}
      description={
        step.kind === 'paired'
          ? undefined
          : 'Run the Pocket Agent Local Agent on the PC you want to connect and enter this one-time code.'
      }
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
          <div className="flex flex-col items-center gap-2 rounded-xl border bg-muted/40 px-4 py-5">
            <div className="flex items-center gap-1">
              <span
                data-testid="pairing-code"
                className="font-mono text-3xl font-semibold tracking-[0.18em] tabular-nums"
              >
                {step.code}
              </span>
              <CopyButton value={step.code} label="Copy code" />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              Single use · expires in {mmss(Math.min(step.expiresAt - now, PAIRING_CODE_TTL_MS))}
            </p>
          </div>

          <ol className="flex flex-col gap-4 text-sm">
            <li className="flex flex-col gap-2">
              <span>
                <span className="font-medium">1.</span> On your PC, install the Pocket Agent app (needs
                Node.js 24+):
              </span>
              <CommandLine command={`npm install -g ${AGENT_NPM_PACKAGE}`} />
            </li>
            <li className="flex flex-col gap-2">
              <span>
                <span className="font-medium">2.</span> Connect this PC. It also starts automatically when you
                sign in to Windows:
              </span>
              <CommandLine command={`pocket-agent setup ${step.code} --api ${api}`} />
            </li>
          </ol>

          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-muted border-t-primary"
              aria-hidden
            />
            Waiting for your PC…
          </p>
          <p className="text-xs text-muted-foreground">
            Already installed? Just run step 2. To connect only for now: add{' '}
            <code className="font-mono">--no-autostart</code>. Remote approval stays off until you run{' '}
            <code className="font-mono">pocket-agent approvals enable</code> on the PC.
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
              <span className="font-medium">{step.device.name}</span> is paired. It shows as Online once{' '}
              <code className="font-mono text-[13px]">pocket-agent setup</code> has started it.
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
