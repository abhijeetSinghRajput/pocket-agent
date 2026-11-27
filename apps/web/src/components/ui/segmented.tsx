'use client';

import { useLayoutEffect, useRef, useState, type ComponentType, type RefObject, type SVGProps } from 'react';
import { cn } from '@/lib/utils';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the element matching `selector` sits inside `container`, kept up to date as either
 * resizes. A highlight positioned with it slides from one item to the next instead of jumping
 * (and keeps its momentum when the target changes mid-way).
 */
export function useFollow(container: RefObject<HTMLElement | null>, selector: string, dep: unknown) {
  const [rect, setRect] = useState<Rect | null>(null);
  // No slide on the first paint: the highlight is simply there.
  const [moving, setMoving] = useState(false);
  useLayoutEffect(() => {
    const box = container.current;
    if (!box) return;
    const measure = () => {
      const el = box.querySelector<HTMLElement>(selector);
      setRect(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    const t = setTimeout(() => setMoving(true), 50);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [container, selector, dep]);
  return { rect, moving };
}

/** Style for a highlight that follows `rect`. */
export function followStyle(rect: Rect | null, moving: boolean) {
  return {
    opacity: rect ? 1 : 0,
    width: rect?.w ?? 0,
    height: rect?.h ?? 0,
    transform: `translate(${rect?.x ?? 0}px, ${rect?.y ?? 0}px)`,
    transition: moving
      ? 'transform 280ms var(--ease-move), width 280ms var(--ease-move), height 280ms var(--ease-move), opacity 160ms'
      : 'none',
  } as const;
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * A row of choices where one is selected. The selected one sits on a raised thumb that slides to
 * the next choice. `as="radio"` for a setting, `as="tab"` for a filter.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  as = 'radio',
  className,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  /** null while the value isn't known yet (nothing is selected). */
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  as?: 'radio' | 'tab';
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { rect, moving } = useFollow(box, '[data-selected="true"]', value);
  return (
    <div
      ref={box}
      role={as === 'radio' ? 'radiogroup' : 'tablist'}
      aria-label={label}
      className={cn('relative inline-flex rounded-xl bg-foreground/[0.07] p-1 dark:bg-black/30', className)}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 rounded-lg bg-white shadow-sm ring-1 ring-black/5 dark:bg-white/15 dark:ring-white/10"
        style={followStyle(rect, moving)}
      />
      {options.map(({ value: v, label: text, icon: Icon }) => {
        const selected = value === v;
        return (
          <button
            key={v}
            type="button"
            role={as}
            {...(as === 'radio' ? { 'aria-checked': selected } : { 'aria-selected': selected })}
            data-selected={selected}
            data-sound={selected ? 'none' : 'select'}
            onClick={() => onChange(v)}
            className={cn(
              'relative z-10 inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-8',
              selected ? 'text-foreground' : 'text-foreground/60 hover:text-foreground',
            )}
          >
            {Icon && <Icon className="size-4" aria-hidden />}
            {text}
          </button>
        );
      })}
    </div>
  );
}
