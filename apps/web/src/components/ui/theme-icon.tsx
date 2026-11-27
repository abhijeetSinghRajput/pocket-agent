'use client';

import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// Kobra's morphing ThemeIcon (kobra.systems/r/morphing-icons, the @kobra registry in
// components.json): a sun whose rays draw in and whose body swells into a moon as a second disc
// slides over it. The same geometry, driven by a small tween here instead of the motion library.

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (x: number) => x * x * (3 - 2 * x);
const stage = (t: number, from: number, to: number) => smooth(clamp01((t - from) / (to - from)));
const n = (v: number) => Math.round(v * 1000) / 1000;

/** Eases toward `target` (0 or 1) over ~600ms, like a spring with no bounce; at once with reduced motion. */
function useTween(target: number, ms = 600) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = still ? 1 : Math.min(1, (now - t0) / ms);
      const v = lerp(start, target, 1 - Math.pow(1 - p, 4)); // a no-bounce spring's settle
      from.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

const CUTTER = 8.2;

/** Sun (`dark` false) or moon (`dark` true), morphing from one to the other when it changes. */
export function ThemeIcon({
  dark = false,
  size = 24,
  strokeWidth = 2,
  className,
  ...props
}: Omit<ComponentProps<'svg'>, 'children'> & { dark?: boolean; size?: number; strokeWidth?: number }) {
  const t = useTween(dark ? 1 : 0);
  const id = useId();
  const body = lerp(4.5, 9, t);
  const cutX = lerp(26, 17.5, t);
  const cutY = lerp(-2, 6.5, t);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('shrink-0', className)}
      {...props}
    >
      <defs>
        <mask id={`${id}-cut`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <circle cx={n(cutX)} cy={n(cutY)} r={CUTTER - strokeWidth / 2} fill="#000" stroke="none" />
        </mask>
        <clipPath id={`${id}-body`}>
          <circle cx={12} cy={12} r={n(body + strokeWidth / 2)} />
        </clipPath>
      </defs>
      <circle cx={12} cy={12} r={n(body)} mask={`url(#${id}-cut)`} />
      <circle cx={n(cutX)} cy={n(cutY)} r={CUTTER} clipPath={`url(#${id}-body)`} />
      {Array.from({ length: 8 }, (_, k) => {
        const from = k * 0.05;
        const a = ((-90 + k * 45 + t * 30) * Math.PI) / 180;
        const reach = lerp(10, 8.5, stage(t, from, from + 0.4));
        const opacity = 1 - stage(t, from, from + 0.25);
        if (opacity <= 0) return null;
        return (
          <path
            key={k}
            opacity={n(opacity)}
            d={`M${n(12 + 8.5 * Math.cos(a))} ${n(12 + 8.5 * Math.sin(a))}L${n(12 + reach * Math.cos(a))} ${n(12 + reach * Math.sin(a))}`}
          />
        );
      })}
    </svg>
  );
}
