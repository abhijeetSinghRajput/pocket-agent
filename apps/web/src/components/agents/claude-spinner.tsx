'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽'];
const SPIN = [...FRAMES, ...FRAMES.slice(1, -1).reverse()]; // ping-pong, like a breathing star

/** Claude-style breathing star. Holds still for people who ask for reduced motion. */
export function ClaudeSpinner({ className }: { className?: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 120);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span aria-hidden className={cn('inline-block w-[1em] text-center font-mono leading-none', className)}>
      {SPIN[tick % SPIN.length]}
    </span>
  );
}
