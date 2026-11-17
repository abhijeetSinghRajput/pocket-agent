import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,box-shadow,transform] outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-white shadow-xs hover:bg-destructive/90',
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
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
