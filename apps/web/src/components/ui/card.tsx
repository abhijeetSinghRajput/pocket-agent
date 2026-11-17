import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-start justify-between gap-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-sm font-semibold leading-none', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
