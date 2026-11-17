'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { ThemeProvider as NextThemes, useTheme } from 'next-themes';
import { useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}

/** True only after hydration, so theme-dependent UI never mismatches the server render. */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const dark = mounted && resolvedTheme === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      data-testid="theme-toggle"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

const OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const;

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-lg border bg-muted p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(value)}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-8',
              selected && 'bg-background text-foreground shadow-xs',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
