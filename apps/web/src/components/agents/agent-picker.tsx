'use client';

import { agentName } from '@pocket-agent/core';
import type { ProviderId } from '@pocket-agent/protocol';
import { Check } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { AgentLogo, agentBackdrop, agentInk } from '@/components/agents/agent-logos';
import { cn } from '@/lib/utils';

/**
 * Which agent a new chat starts: a grid of tiles, three to a row, Claude first and then every other
 * agent the PC can start. The picked one has the accent edge, a wash and a tick; the tile it left
 * eases back out. Arrow keys move the choice, like any radio group.
 */
export function AgentPicker({
  agents,
  value,
  onChange,
}: {
  agents: ProviderId[];
  value: ProviderId;
  onChange: (next: ProviderId) => void;
}) {
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const step =
      e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowLeft'
          ? -1
          : e.key === 'ArrowDown'
            ? 3
            : e.key === 'ArrowUp'
              ? -3
              : 0;
    if (!step) return;
    e.preventDefault();
    const at = agents.indexOf(value);
    const next = Math.min(agents.length - 1, Math.max(0, at + step));
    if (next === at) return;
    onChange(agents[next]!);
    tiles.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Agent"
      data-testid="agent-choice"
      onKeyDown={onKey}
      className="grid grid-cols-3 gap-2"
    >
      {agents.map((p, i) => {
        const selected = p === value;
        const name = agentName(p);
        return (
          <button
            key={p}
            ref={(el) => {
              tiles.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={name}
            tabIndex={selected ? 0 : -1}
            data-testid={`agent-${p}`}
            // Picking another agent plays the choice; the one already picked is silent.
            data-sound={selected ? 'none' : 'select'}
            onClick={() => {
              if (!selected) onChange(p);
            }}
            style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
            className={cn(
              'rise-in relative flex h-[84px] min-w-0 flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] px-1.5 outline-none',
              'transition-[border-color,background-color,scale] duration-200 ease-(--ease-out) focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.97]',
              selected ? 'border-primary bg-primary/12' : 'border-border bg-card hover:bg-accent/60',
            )}
          >
            <span
              aria-hidden
              className="agent-ink grid size-9 place-items-center rounded-lg"
              style={{ ...agentInk(p), backgroundColor: agentBackdrop(p) }}
            >
              <AgentLogo provider={p} className="size-[22px]" />
            </span>
            <span
              className={cn(
                'max-w-full truncate text-xs font-medium transition-colors duration-200',
                selected ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {name}
            </span>
            {/* The tick grows in on the picked tile and fades from the one it left. */}
            <span
              aria-hidden
              className={cn(
                'absolute top-1.5 right-1.5 grid size-[18px] place-items-center rounded-full bg-primary text-white transition-[opacity,scale] duration-200 ease-(--ease-out)',
                selected ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
              )}
            >
              <Check className="size-[11px]" strokeWidth={3.2} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
