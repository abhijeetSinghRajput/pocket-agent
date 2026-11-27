'use client';

import { X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useBackToClose } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * The app's sheet (apps/mobile/src/ui/sheet.tsx): on a phone it rises from the bottom edge with a
 * handle, and can be dragged down from the handle or the title to close it; the content under the
 * title scrolls on its own. On a wider screen it is a centred dialog with a close button.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  useBackToClose(open, () => onOpenChange(false));
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number; v: number } | null>(null);
  // Dragged away: it is already off screen, so it closes without the slide-out.
  const [dragged, setDragged] = useState(false);
  if (open && dragged) setDragged(false);

  const onDown = (e: PointerEvent) => {
    // Only on a phone layout (the handle is hidden on wider screens), and not from a button.
    if (window.matchMedia('(min-width: 40rem)').matches) return;
    if ((e.target as Element).closest('button, a, input')) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0, v: 0 };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    const el = panel.current;
    if (!d || !el) return;
    const now = performance.now();
    const dy = Math.max(0, e.clientY - d.y);
    d.v = ((dy - d.dy) / Math.max(1, now - d.t)) * 1000;
    d.dy = dy;
    d.t = now;
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
  };
  const onUp = () => {
    const d = drag.current;
    const el = panel.current;
    drag.current = null;
    if (!d || !el) return;
    const away = d.dy > el.offsetHeight * 0.22 || d.v > 900;
    el.style.transition = 'transform 340ms var(--ease-out)';
    el.style.transform = away ? 'translateY(100%)' : '';
    if (away) {
      setTimeout(() => {
        setDragged(true);
        onOpenChange(false);
        el.style.transition = '';
        el.style.transform = '';
      }, 220);
    }
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-300" />
        <D.Content
          ref={panel}
          data-testid={testId}
          data-dragged={dragged || undefined}
          className={cn(
            'fixed z-50 flex flex-col bg-popover text-popover-foreground outline-none',
            // Phone: a sheet on the bottom edge, as tall as needed (up to below the status bar).
            'inset-x-0 bottom-0 max-h-[calc(100dvh-1.5rem)] rounded-t-3xl pb-[calc(1rem+env(safe-area-inset-bottom))]',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-[460ms] data-[state=open]:ease-[cubic-bezier(0.3,0.75,0.1,1)]',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=closed]:duration-[340ms] data-[state=closed]:ease-(--ease-move)',
            'data-dragged:animate-none',
            // Wider: a centred dialog.
            'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[90dvh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border sm:pb-5 sm:shadow-lg',
            'sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=open]:fade-in-0 sm:data-[state=open]:duration-200',
            'sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=closed]:fade-out-0 sm:data-[state=closed]:duration-150',
            className,
          )}
        >
          {/* Drag down from the handle or the title; the content below scrolls on its own. */}
          <div
            className="shrink-0 touch-none select-none sm:touch-auto sm:select-auto"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <div className="flex justify-center pt-2.5 pb-1.5 sm:hidden" aria-hidden>
              <div className="h-[4.5px] w-10 rounded-full bg-border" />
            </div>
            <div className="flex items-start gap-3 px-5 pt-2 pb-3 sm:pt-5">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <D.Title className="text-lg leading-6 font-semibold tracking-[-0.2px]">{title}</D.Title>
                {description ? (
                  <D.Description className="text-sm text-muted-foreground">{description}</D.Description>
                ) : (
                  <D.Description className="sr-only">{title}</D.Description>
                )}
              </div>
              <D.Close
                aria-label="Close"
                className="-mt-1 -mr-2 hidden size-9 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:grid"
              >
                <X className="size-5" />
              </D.Close>
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-1">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
