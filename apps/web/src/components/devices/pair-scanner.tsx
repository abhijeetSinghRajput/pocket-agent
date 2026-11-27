'use client';

import { pairingRequestId } from '@pocket-agent/protocol';
import { X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PairRequest } from '@/components/devices/pair-approve';
import { Button } from '@/components/ui/button';
import { useBackToClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { cn } from '@/lib/utils';

/** The browser's QR reader (Chrome on Android, macOS; not every browser has it). */
interface Detector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
type DetectorClass = new (opts: { formats: string[] }) => Detector;
const detectorClass = () =>
  (globalThis as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector ?? null;

const NOT_OURS = 'That isn’t a Pocket Agent code. Run `pocket-agent connect` on the PC.';

type Camera = 'asking' | 'on' | 'denied' | 'none';

/**
 * Pairing a PC by its QR code (`pocket-agent connect` without a code shows one): read it with the
 * camera where the browser can, or paste the link the PC prints under it; then compare the check
 * code and approve, as in the app's scanner. The PC connects by itself.
 */
export function PairScanner({ open, onClose }: { open: boolean; onClose: () => void }) {
  useBackToClose(open, onClose);
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[60] bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content
          data-testid="pair-scanner"
          aria-describedby={undefined}
          className={cn(
            'fixed inset-0 z-[60] flex flex-col overflow-hidden bg-background outline-none',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-[460ms] data-[state=open]:ease-[cubic-bezier(0.3,0.75,0.1,1)]',
            'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(640px,90dvh)] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border',
            'sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=open]:duration-200',
          )}
        >
          {open && <Scanner onClose={onClose} />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Scanner({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<Camera>('asking');
  const [attempt, setAttempt] = useState(0);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState('');

  // The camera, while scanning: the back one, reading every few frames.
  useEffect(() => {
    if (requestId) return;
    const Reader = detectorClass();
    if (!Reader || !navigator.mediaDevices?.getUserMedia) {
      const t = setTimeout(() => setCamera('none'), 0);
      return () => clearTimeout(t);
    }
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const reader = new Reader({ formats: ['qr_code'] });
    const read = async () => {
      if (stopped || !video.current) return;
      try {
        const [hit] = await reader.detect(video.current);
        if (hit && !stopped) {
          const id = pairingRequestId(hit.rawValue);
          if (id) {
            navigator.vibrate?.(15);
            setRequestId(id);
            return;
          }
          setNote(NOT_OURS);
        }
      } catch {
        /* a frame that isn't ready yet */
      }
      timer = setTimeout(() => void read(), 250);
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        setCamera('on');
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        void read();
      })
      .catch((err: Error) => setCamera(err.name === 'NotAllowedError' ? 'denied' : 'none'));
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [requestId, attempt]);

  function pasted(e: FormEvent) {
    e.preventDefault();
    const id = pairingRequestId(link);
    if (id) setRequestId(id);
    else setNote(NOT_OURS);
  }

  const live = camera === 'on' && !requestId;
  return (
    <div className={cn('relative flex flex-1 flex-col', live && 'bg-black text-white')}>
      {/* The camera's picture, behind everything (kept mounted while it starts). */}
      {!requestId && (
        <video
          ref={video}
          muted
          playsInline
          aria-hidden
          className={cn('absolute inset-0 size-full object-cover', !live && 'hidden')}
        />
      )}
      <div className="relative z-10 flex items-center gap-1 px-3 pt-[calc(0.5rem+env(safe-area-inset-top))] sm:pt-3">
        <D.Close
          aria-label="Close"
          className={cn(
            'grid size-10 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            live ? 'text-white hover:bg-white/15' : 'text-foreground hover:bg-accent',
          )}
        >
          <X className="size-5" />
        </D.Close>
        <D.Title className="text-base font-semibold">Connect a PC</D.Title>
      </div>

      {requestId ? (
        <div className="relative z-10 flex flex-1 flex-col justify-center gap-4 overflow-y-auto p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] rise-in">
          <PairRequest id={requestId} onDone={onClose} />
        </div>
      ) : live ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 px-8">
          {/* Where to hold the code. */}
          <div className="size-60 rounded-3xl border-[3px] border-white/85" aria-hidden />
          <div className="flex flex-col gap-1.5 text-center">
            <p>Point at the QR code from `pocket-agent connect` on your PC</p>
            {note && <p className="text-sm text-white/80">{note}</p>}
          </div>
        </div>
      ) : camera === 'asking' ? (
        <div className="flex-1" aria-busy="true" />
      ) : (
        <div className="relative z-10 flex flex-1 flex-col justify-center gap-3.5 overflow-y-auto p-6">
          {camera === 'denied' ? (
            <>
              <h2 className="text-lg font-semibold">Allow the camera</h2>
              <p className="text-muted-foreground">
                The camera is used only here, to read the QR code your PC shows. Nothing is recorded.
              </p>
              <Button
                className="h-12 w-full rounded-[18px] text-base font-semibold"
                onClick={() => setAttempt((n) => n + 1)}
                data-testid="allow-camera"
              >
                Allow camera
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">Scan with your phone’s camera</h2>
              <p className="text-muted-foreground">
                Point it at the QR code from `pocket-agent connect` on your PC, or paste the link the PC
                shows under the code.
              </p>
            </>
          )}
          <form onSubmit={pasted} className="mt-2 flex flex-col gap-2.5">
            <Input
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setNote(null);
              }}
              placeholder="Paste the link from the PC"
              aria-label="Link from the PC"
              inputMode="url"
              autoComplete="off"
              data-testid="pair-link"
            />
            {note && <Notice>{note}</Notice>}
            <Button
              type="submit"
              variant="secondary"
              className="h-11 w-full rounded-[14px] text-[15px]"
              disabled={!link.trim()}
            >
              Continue
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
