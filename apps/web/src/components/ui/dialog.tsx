'use client';

import { X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * On a phone, Back closes what is open (a dialog, a sheet) instead of leaving the page. While open,
 * the overlay owns one history entry: Back pops it and closes; closing any other way removes it.
 */
export function useBackToClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open || !window.matchMedia('(pointer: coarse)').matches) return;
    const id = `overlay-${Date.now()}-${Math.random()}`;
    let pushed = false;
    let popped = false;
    // Deferred, so an open that is undone at once (React's dev double-run) leaves history alone.
    const t = setTimeout(() => {
      // Keep the router's own state in the entry: only our marker is added.
      window.history.pushState({ ...(window.history.state as object | null), pocketAgentOverlay: id }, '');
      pushed = true;
    }, 0);
    const onPop = () => {
      if (!pushed) return;
      popped = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      clearTimeout(t);
      window.removeEventListener('popstate', onPop);
      const top = (window.history.state as { pocketAgentOverlay?: string } | null)?.pocketAgentOverlay;
      // Closed with its button or a tap outside: take our entry off again.
      if (pushed && !popped && top === id) window.history.back();
    };
  }, [open]);
}

/** Centered dialog on desktop, bottom sheet on phones (easier to reach with a thumb). */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
}) {
  useBackToClose(open, () => onOpenChange(false));
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <D.Content
          role={role}
          className={cn(
            'fixed z-50 flex max-h-[90dvh] flex-col overflow-y-auto border bg-popover text-popover-foreground shadow-lg outline-none',
            'inset-x-0 bottom-0 rounded-t-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]',
            'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-6',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-8 data-[state=open]:duration-200 sm:data-[state=open]:zoom-in-95 sm:data-[state=open]:slide-in-from-bottom-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150',
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{title}</D.Description>
              )}
            </div>
            <D.Close
              aria-label="Close"
              className="-m-2 grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <X className="size-5" />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
