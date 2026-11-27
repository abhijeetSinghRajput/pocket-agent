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
  // `rect` is where the highlight last sat (kept while nothing is selected, so it fades out in
  // place); `shown` is whether something is selected now; `moving` whether a change may slide.
  const [state, setState] = useState<{ rect: Rect | null; shown: boolean; moving: boolean }>({
    rect: null,
    shown: false,
    moving: false,
  });
  // No slide on the first paint: the highlight is simply there.
  const ready = useRef(false);
  useLayoutEffect(() => {
    const t = setTimeout(() => (ready.current = true), 50);
    return () => clearTimeout(t);
  }, []);
  useLayoutEffect(() => {
    const box = container.current;
    if (!box) return;
    const measure = () => {
      const el = box.querySelector<HTMLElement>(selector);
      setState((s) =>
        el
          ? {
              rect: { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight },
              shown: true,
              // Slide only from one item to another. Appearing after nothing was selected, it
              // is simply there (fading in) instead of flying in from the corner.
              moving: ready.current && s.shown,
            }
          : { ...s, shown: false, moving: true },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [container, selector, dep]);
  return { rect: state.shown ? state.rect : null, last: state.rect, moving: state.moving };
}

/** Style for a highlight that follows `rect` (`last` is where it sat, to fade out there). */
export function followStyle(rect: Rect | null, moving: boolean, last: Rect | null = rect) {
  const at = rect ?? last;
  return {
    opacity: rect ? 1 : 0,
    width: at?.w ?? 0,
    height: at?.h ?? 0,
    transform: `translate(${at?.x ?? 0}px, ${at?.y ?? 0}px)`,
    transition: moving
      ? 'transform 280ms var(--ease-move), width 280ms var(--ease-move), height 280ms var(--ease-move), opacity 160ms'
      : 'opacity 160ms',
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
  const { rect, last, moving } = useFollow(box, '[data-selected="true"]', value);
  return (
    <div
      ref={box}
      role={as === 'radio' ? 'radiogroup' : 'tablist'}
      aria-label={label}
      // The app's colours: the muted track, the choice on a card-coloured pill.
      className={cn('relative inline-flex rounded-xl bg-muted p-1', className)}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 rounded-lg bg-card shadow-sm ring-1 ring-black/5 dark:shadow-none dark:ring-border"
        style={followStyle(rect, moving, last)}
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
