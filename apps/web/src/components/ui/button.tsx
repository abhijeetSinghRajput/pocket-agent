import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Buttons. The coloured ones are raised and tactile: the surface is drawn on `::before` (a soft top-lit gradient, an inked
 * edge, a highlight on the top lip and a short drop shadow), so a press squeezes only the surface
 * while the label stays crisp. Grey ones (secondary, outline) are flat, as in the app. The look
 * lives in globals.css (`.raise`, `.raise-*`).
 */
export const buttonVariants = cva(
  'raise relative isolate inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'raise-primary text-primary-foreground',
        secondary: 'raise-flat text-secondary-foreground',
        outline: 'raise-outline text-foreground',
        ghost: 'raise-ghost hover:text-accent-foreground',
        destructive: 'raise-danger text-white',
      },
      size: {
        default: 'h-10 px-4 sm:h-9',
        sm: 'h-9 px-3 sm:h-8',
        lg: 'h-11 px-6',
        icon: 'size-10 sm:size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? 'default'}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
