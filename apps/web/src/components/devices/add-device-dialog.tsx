'use client';

import { CheckCircle2 } from 'lucide-react';
import { useEffect } from 'react';
import { ConnectSteps } from '@/components/devices/connect-steps';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { playSound } from '@/components/ui/sound';
import { usePairing } from '@/components/devices/use-pairing';

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
  const paired = step.kind === 'paired';
  // The PC is in: the same sound as the app.
  useEffect(() => {
    if (open && paired) playSound('landed');
  }, [open, paired]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={step.kind === 'paired' ? 'Device paired' : 'Pair a device'}
      description={step.kind === 'paired' ? undefined : 'Run these in PowerShell on the PC.'}
    >
      {step.kind !== 'paired' && (
        <ConnectSteps
          step={step}
          now={now}
          regenerate={() => void createCode()}
          footer={
            <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              <span
                className="size-3.5 animate-spin rounded-full border-2 border-muted border-t-primary"
                aria-hidden
              />
              Waiting for your PC…
            </p>
          }
        />
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
