'use client';

import type { LookTokens } from './kit';

/**
 * The demos in the site's own look: light (the landing page is always light), its orange (the
 * page's --primary) and Geist.
 */
export function useStageLook(): { theme: 'light' | 'dark'; accent: string; tokens: LookTokens } {
  return {
    theme: 'light',
    accent: 'var(--primary)',
    tokens: {
      '--ss-font': 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif',
      '--ss-mono': 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
    } as LookTokens,
  };
}
