import { useState } from 'react';
import { enter } from '@/lib/motion';

interface Seen {
  ids: readonly string[] | null;
  /** Everything shown before the current `ids` (null until the first batch has been shown). */
  before: ReadonlySet<string> | null;
}

/**
 * Tells a list which of its items are arriving. The first batch rises in reading order (staggered
 * by index); an item that joins later rises alone; anything already shown (re-mounted by scrolling,
 * back after a search, re-rendered by a refresh) is simply there and does not animate.
 *
 * `ids` must be a stable (memoised) array of the items' ids, null while nothing has loaded.
 */
export function useArrivals(ids: readonly string[] | null) {
  const [seen, setSeen] = useState<Seen>({ ids: null, before: null });
  if (ids !== seen.ids) {
    // The list changed: what was on screen until now is what counts as already seen.
    setSeen({
      ids,
      before: seen.ids === null ? null : new Set([...(seen.before ?? []), ...seen.ids]),
    });
  }
  const before = seen.before;
  return (id: string, index: number) =>
    before === null ? enter.rise(index) : before.has(id) ? undefined : enter.rise(0);
}
