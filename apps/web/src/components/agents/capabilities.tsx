import type { AgentSessionDto } from '@pocket-agent/protocol';
import { Check, Clock, X } from 'lucide-react';
import { capabilityRows } from '@pocket-agent/core';
import { cn } from '@/lib/utils';

const ICON = {
  yes: { Icon: Check, cls: 'bg-success/15 text-success', sr: 'Available' },
  soon: { Icon: Clock, cls: 'bg-primary/10 text-primary', sr: 'Supported, not yet available' },
  no: { Icon: X, cls: 'bg-muted text-muted-foreground', sr: 'Not available' },
} as const;

export function CapabilityList({ session }: { session: AgentSessionDto }) {
  return (
    <ul className="flex flex-col gap-3" data-testid="capabilities">
      {capabilityRows(session).map((r) => {
        const { Icon, cls, sr } = ICON[r.state];
        return (
          <li key={r.label} className="flex gap-3" data-capability={r.label} data-state={r.state}>
            <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', cls)}>
              <Icon className="size-3" aria-hidden />
              <span className="sr-only">{sr}</span>
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{r.label}</p>
              <p className="text-xs text-muted-foreground">{r.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
