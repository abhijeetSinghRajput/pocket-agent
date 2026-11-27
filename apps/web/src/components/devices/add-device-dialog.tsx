'use client';

import { CircleCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConnectStatus, ConnectSteps, type ConnectMode } from '@/components/devices/connect-steps';
import { usePairing } from '@/components/devices/use-pairing';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { playSound } from '@/components/ui/sound';

/** "Add device": the two ways to pair in a sheet, following the PC live until it is paired. */
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
  const { step, now, regenerate } = usePairing({ active: open, knownDeviceIds, onPaired });
  const paired = step.kind === 'paired';
  const [mode, setMode] = useState<ConnectMode>('scan');

  // The PC is in.
  useEffect(() => {
    if (open && paired) {
      navigator.vibrate?.(20);
      playSound('success');
    }
  }, [open, paired]);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={paired ? 'Device paired' : 'Pair a device'}
      description={paired ? undefined : 'Run these in a terminal on the PC.'}
      testId="add-device"
    >
      {paired ? (
        <div className="flex flex-col gap-5 pb-1 animate-in fade-in-0 duration-300">
          <div className="flex items-start gap-3 rounded-[14px] border border-success/30 bg-success/10 p-4">
            <CircleCheck
              className="mt-0.5 size-5 shrink-0 text-success animate-in zoom-in-50 fade-in-0 duration-300"
              strokeWidth={2.2}
              aria-hidden
            />
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{step.device.name}</span>{' '}
              {step.device.status === 'Online'
                ? 'is connected and online.'
                : 'is paired. It shows as Online in a moment.'}
            </p>
          </div>
          <Button
            onClick={() => onOpenChange(false)}
            className="h-11 self-end rounded-[14px] px-4 text-[15px]"
            data-testid="add-device-done"
          >
            Done
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-1">
          <ConnectSteps
            step={step}
            now={now}
            regenerate={() => void regenerate()}
            mode={mode}
            onModeChange={setMode}
          />
          <ConnectStatus step={step} mode={mode} />
        </div>
      )}
    </Sheet>
  );
}
