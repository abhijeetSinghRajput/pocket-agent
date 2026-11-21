'use client';

import { useEffect, useRef, useState } from 'react';
import { CopyMark, useCopy } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';

export interface TerminalStep {
  /** The command to run, exactly as it should be typed. */
  command: string;
  /** What the terminal answers (the real first line of that command's output). */
  output?: string;
}

const TYPE_MS = 26;
const AFTER_COMMAND_MS = 420;
const AFTER_OUTPUT_MS = 520;

/**
 * A small terminal that shows a guide's commands being typed, so "run this on your PC" is something
 * you can see, not a paragraph to read. It is an illustration with real content: the commands are
 * the exact ones to run (each has a copy button) and the outputs are what the CLI really prints.
 *
 * Drawn the way a terminal is: one dark surface in both themes, grey window lights, a dim centred
 * title, a `path ❯ command` prompt, a block caret that holds while typing and blinks at rest. It
 * plays once when scrolled into view and then stays on its last frame; with reduced motion it
 * simply shows that frame.
 */
export function TerminalGuide({
  steps,
  path = '~',
  title = 'Terminal',
  className,
}: {
  steps: TerminalStep[];
  path?: string;
  title?: string;
  className?: string;
}) {
  const total = steps.reduce((n, s) => n + s.command.length, 0);
  // Progress: characters typed across all commands, and how many outputs are showing.
  const [typed, setTyped] = useState(0);
  const [shown, setShown] = useState(0);
  const [started, setStarted] = useState(false);
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const t = setTimeout(() => {
        setTyped(total);
        setShown(steps.length);
        setStarted(true);
      }, 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setStarted(true);
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [total, steps.length]);

  // One timer drives it: type the current command, pause, show its output, pause, next command.
  useEffect(() => {
    if (!started) return;
    let before = 0;
    for (let i = 0; i < steps.length; i++) {
      const end = before + steps[i]!.command.length;
      if (typed < end) {
        const t = setTimeout(
          () => setTyped((n) => n + 1),
          i > 0 && typed === before ? AFTER_OUTPUT_MS : TYPE_MS,
        );
        return () => clearTimeout(t);
      }
      if (shown <= i) {
        const t = setTimeout(() => setShown(i + 1), AFTER_COMMAND_MS);
        return () => clearTimeout(t);
      }
      before = end;
    }
    return undefined;
  }, [started, typed, shown, steps]);

  const done = typed >= total && shown >= steps.length;
  // Where each command starts and ends in the count of typed characters.
  const ends = steps.map((_, i) => steps.slice(0, i + 1).reduce((n, x) => n + x.command.length, 0));
  return (
    <figure
      ref={box}
      aria-label={`${title}: ${steps.map((s) => s.command).join(', then ')}`}
      data-testid="terminal-guide"
      className={cn(
        'overflow-hidden rounded-xl bg-[#17171a] font-mono text-[12.5px] leading-[1.7] text-[#f1f1f3] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07),0_10px_30px_-12px_rgba(0,0,0,0.45)]',
        className,
      )}
    >
      <div className="relative flex h-8 items-center bg-white/[0.09] px-3" aria-hidden>
        <span className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2.5 rounded-full bg-white/25" />
          ))}
        </span>
        <span className="absolute left-1/2 -translate-x-1/2 font-sans text-[11px] text-white/60">
          {title}
        </span>
      </div>
      <div className="px-3.5 pt-2.5 pb-3">
        {steps.map((step, i) => {
          const end = ends[i]!;
          const start = end - step.command.length;
          const n = Math.max(0, Math.min(step.command.length, typed - start));
          const active = typed >= start && (typed < end || shown <= i);
          // A line not reached yet keeps its place (the terminal never changes height) but is hidden.
          // It is the same element later, so nothing flashes when its turn comes.
          const reached = started && typed >= start;
          return (
            <div
              key={i}
              className={reached ? undefined : 'invisible'}
              aria-hidden={reached ? undefined : true}
            >
              <div className="group/line flex items-start gap-2">
                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span className="text-[#6f8ccf]">{path}</span>
                  <span className="mx-[7px] text-[#6ee7a8]">❯</span>
                  <span>{step.command.slice(0, n)}</span>
                  {active && typed < end && <Caret still />}
                  {/* The rest of the command reserves its space, so nothing reflows as it is typed. */}
                  <span className="opacity-0" aria-hidden>
                    {step.command.slice(n)}
                  </span>
                </div>
                <CopyCommand command={step.command} />
              </div>
              {step.output && (
                <div
                  className={cn(
                    '[overflow-wrap:anywhere] text-[#6ee7a8] transition-opacity duration-300',
                    shown > i ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  {step.output}
                </div>
              )}
            </div>
          );
        })}
        {/* At rest: a fresh prompt with a blinking caret. */}
        <div
          className={cn('transition-opacity duration-300', done ? 'opacity-100' : 'opacity-0')}
          aria-hidden
        >
          <span className="text-[#6f8ccf]">{path}</span>
          <span className="mx-[7px] text-[#6ee7a8]">❯</span>
          <Caret />
        </div>
      </div>
    </figure>
  );
}

function Caret({ still }: { still?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'ml-px inline-block h-[1.2em] w-[0.6em] align-[-0.22em] bg-[#e8e8ec]',
        !still && 'term-caret',
      )}
    />
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, copy] = useCopy(command);
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied' : `Copy: ${command}`}
      title="Copy command"
      className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md text-white/45 outline-none [--copy-ok:#34c77b] hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/50 active:scale-95"
    >
      <CopyMark copied={copied} className="size-3.5" />
    </button>
  );
}
