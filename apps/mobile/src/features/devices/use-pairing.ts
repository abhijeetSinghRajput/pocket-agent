import { DeviceListResponse, PairingCodeResponse, type DeviceDto } from '@pocket-agent/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api';

export type PairingStep =
  | { kind: 'creating' }
  | { kind: 'code'; code: string; expiresAt: number }
  /** The code ran out before a PC used it (kept to show it crossed out). */
  | { kind: 'expired'; code: string }
  /** The PC used the code. `device.status` turns Online once its background service connects. */
  | { kind: 'paired'; device: DeviceDto }
  | { kind: 'error'; message: string };

/**
 * One pairing attempt: creates a code while `active`, counts it down, and watches for the PC that
 * uses it (any device not in `knownDeviceIds` when it became active). After pairing it keeps
 * watching that device until it is Online, so the UI can say "connected" only when it really is.
 */
export function usePairing({
  active,
  knownDeviceIds,
  onPaired,
}: {
  active: boolean;
  knownDeviceIds: string[];
  onPaired?: (device: DeviceDto) => void;
}) {
  const [step, setStep] = useState<PairingStep>({ kind: 'creating' });
  const [now, setNow] = useState(() => Date.now());
  const known = useRef(new Set<string>());
  const onPairedRef = useRef(onPaired);
  useEffect(() => {
    onPairedRef.current = onPaired;
  }, [onPaired]);

  const regenerate = useCallback(async () => {
    setStep({ kind: 'creating' });
    try {
      const res = await apiRequest('/devices/pairing-codes', PairingCodeResponse, { method: 'POST' });
      setStep({ kind: 'code', code: res.code, expiresAt: Date.parse(res.expiresAt) });
    } catch (err) {
      setStep({ kind: 'error', message: (err as Error).message });
    }
  }, []);

  // New code each time it becomes active; remember which devices already existed.
  useEffect(() => {
    if (!active) return;
    known.current = new Set(knownDeviceIds);
    const id = setTimeout(() => void regenerate(), 0);
    return () => clearTimeout(id);
    // knownDeviceIds intentionally read only at activation time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, regenerate]);

  // While waiting: tick the countdown and watch for the new device. An expired code still waits,
  // since the PC can also pair by its QR code.
  const waiting = step.kind === 'code' || step.kind === 'expired';
  useEffect(() => {
    if (!active || !waiting) return;
    const tick = setInterval(() => {
      setNow(Date.now());
      setStep((s) =>
        s.kind === 'code' && Date.now() >= s.expiresAt ? { kind: 'expired', code: s.code } : s,
      );
    }, 1000);
    const watch = setInterval(async () => {
      try {
        const { devices } = await apiRequest('/devices', DeviceListResponse);
        const fresh = devices.find((d) => !known.current.has(d.id) && d.status !== 'Revoked');
        if (fresh) {
          setStep({ kind: 'paired', device: fresh });
          onPairedRef.current?.(fresh);
        }
      } catch {
        /* keep waiting; transient errors are fine here */
      }
    }, 2000);
    return () => {
      clearInterval(tick);
      clearInterval(watch);
    };
  }, [active, waiting]);

  // Paired but not online yet: follow that device until its background service connects.
  const pairedId = step.kind === 'paired' && step.device.status !== 'Online' ? step.device.id : null;
  useEffect(() => {
    if (!active || !pairedId) return;
    const watch = setInterval(async () => {
      try {
        const { devices } = await apiRequest('/devices', DeviceListResponse);
        const d = devices.find((x) => x.id === pairedId);
        if (d && d.status !== 'Offline') setStep({ kind: 'paired', device: d });
      } catch {
        /* keep waiting */
      }
    }, 2000);
    return () => clearInterval(watch);
  }, [active, pairedId]);

  return { step, now, regenerate };
}
