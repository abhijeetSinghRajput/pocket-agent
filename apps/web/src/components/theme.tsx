'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { ThemeProvider as NextThemes, useTheme } from 'next-themes';
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem>
      <ThemeHotkey />
      {children}
    </NextThemes>
  );
}

type Theme = 'light' | 'dark' | 'system';

/**
 * Changes the theme with a soft cross-fade of the whole page (View Transitions API), applying the
 * class inside the transition so both snapshots are right. Falls back to an instant switch.
 */
export function useSmoothTheme() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const set = useCallback(
    (next: Theme) => {
      const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!doc.startViewTransition || reduce) return setTheme(next);
      const resolved =
        next === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : next;
      doc.startViewTransition(() => {
        const root = document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(resolved);
        root.style.colorScheme = resolved;
        setTheme(next);
      });
    },
    [setTheme],
  );
  return { theme, resolvedTheme, setTheme: set };
}

/** Is the user typing somewhere (so a letter key must not trigger a shortcut)? */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (t as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
}

/** "D" toggles light/dark anywhere, except while typing or with a modifier key held. */
function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useSmoothTheme();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'd' || e.repeat || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [resolvedTheme, setTheme]);
  return null;
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
  const { resolvedTheme, setTheme } = useSmoothTheme();
  const mounted = useMounted();
  const dark = mounted && resolvedTheme === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={`${dark ? 'Light' : 'Dark'} theme (D)`}
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
  const { theme, setTheme } = useSmoothTheme();
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
