'use client';

import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * The copy glyph and its "copied" tick, sharing one spot so the button never changes size and
 * nothing is swapped out: the copy icon recedes while a disc grows in its place and the tick is
 * drawn inside it, then it all runs back. `copied` drives it.
 */
export function CopyMark({ copied, className }: { copied: boolean; className?: string }) {
  return (
    <span className={cn('grid size-4 place-items-center *:col-start-1 *:row-start-1', className)} aria-hidden>
      <Copy
        className={cn(
          'size-full transition-[opacity,scale] duration-200 ease-(--ease-out)',
          copied ? 'scale-50 opacity-0' : 'scale-100 opacity-100',
        )}
      />
      <svg viewBox="0 0 16 16" fill="none" className="size-full overflow-visible">
        <circle
          cx="8"
          cy="8"
          r="8"
          className={cn(
            'origin-center fill-(--copy-ok,var(--success)) transition-[opacity,scale] duration-250 ease-(--ease-out)',
            copied ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
          )}
        />
        {/* The tick is drawn (not faded in) once its disc is nearly full size. */}
        <path
          d="M4.6 8.3 7 10.6l4.4-5"
          pathLength={1}
          stroke="white"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={1}
          className={cn(
            'transition-[stroke-dashoffset] ease-(--ease-out)',
            copied ? 'delay-100 duration-300 [stroke-dashoffset:0]' : 'duration-150 [stroke-dashoffset:1]',
          )}
        />
      </svg>
    </span>
  );
}

/** `[copied, copy]`: copies text and stays "copied" for a moment. */
export function useCopy(value: string, holdMs = 1600) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), holdMs);
    return () => clearTimeout(id);
  }, [copied, holdMs]);
  const copy = () => void navigator.clipboard?.writeText(value).then(() => setCopied(true));
  return [copied, copy] as const;
}

export function CopyButton({
  value,
  label = 'Copy',
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, copy] = useCopy(value);
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : label}
      title={label}
      onClick={copy}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95',
        className,
      )}
    >
      <CopyMark copied={copied} />
    </button>
  );
}
