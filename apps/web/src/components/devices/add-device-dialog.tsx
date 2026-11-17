'use client';

import {
  DeviceListResponse,
  PAIRING_CODE_TTL_MS,
  PairingCodeResponse,
  type DeviceDto,
} from '@agentdock/protocol';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Modal } from '@/components/ui/dialog';
import { apiBaseUrl, apiRequest } from '@/lib/api';
import { mmss } from '@/lib/format';

type Step =
  | { kind: 'creating' }
  | { kind: 'code'; code: string; expiresAt: number }
  | { kind: 'expired' }
  | { kind: 'paired'; device: DeviceDto }
  | { kind: 'error'; message: string };

function CommandLine({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-muted/60 py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 py-1.5 font-mono text-[13px] break-all">{command}</code>
      <CopyButton value={command} label="Copy command" />
    </div>
  );
}

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

  const api = apiBaseUrl();

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={step.kind === 'paired' ? 'Device paired' : 'Pair a device'}
      description={
        step.kind === 'paired'
          ? undefined
          : 'Run the AgentDock Local Agent on the PC you want to connect and enter this one-time code.'
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
                <span className="font-medium">1.</span> On your PC, pair the Local Agent:
              </span>
              <CommandLine command={`pnpm agentdock pair ${step.code} --api ${api}`} />
            </li>
            <li className="flex flex-col gap-2">
              <span>
                <span className="font-medium">2.</span> Then start it:
              </span>
              <CommandLine command="pnpm agentdock start" />
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
            Run these from the AgentDock repository for now. A Windows installer arrives with M7.
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
              <code className="font-mono text-[13px]">pnpm agentdock start</code> is running.
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
