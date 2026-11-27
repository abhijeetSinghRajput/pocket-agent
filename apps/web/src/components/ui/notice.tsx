import type { ReactNode } from 'react';

/** The app's `Notice`: a tinted box saying something went wrong. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md bg-destructive/12 px-3 py-2.5 text-sm text-pretty text-destructive">
      {children}
    </p>
  );
}
