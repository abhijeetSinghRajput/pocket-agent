import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-1 text-sm text-pretty text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Honest placeholder for a section whose backend is not built yet. Says which milestone delivers it
 * instead of showing mock data (architecture: Approved constraints #5).
 */
export function NotYetAvailable({
  icon: Icon,
  title,
  milestone,
  children,
}: {
  icon: LucideIcon;
  title: string;
  milestone: string;
  children: ReactNode;
}) {
  return (
    <section
      data-testid="not-yet-available"
      className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center"
    >
      <span className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <h2 className="mt-4 text-base font-semibold">{title}</h2>
      <div className="mt-2 max-w-md text-sm text-pretty text-muted-foreground">{children}</div>
      <Badge variant="accent" className="mt-4">
        Arrives in {milestone}
      </Badge>
    </section>
  );
}
