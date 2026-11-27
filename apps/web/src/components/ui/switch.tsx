'use client';

import { cn } from '@/lib/utils';

/**
 * An on/off switch, the app's `Toggle`: a 48×28 track that takes the primary colour when on and a
 * white knob that slides across. `role="switch"` also gives it the toggle sounds.
 */
export function Switch({
  on,
  label,
  disabled,
  onChange,
  testId,
  className,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-[3px] transition-colors duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
        on ? 'bg-primary' : 'bg-input',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-[22px] rounded-full bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)] motion-reduce:transition-none',
          on ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}
