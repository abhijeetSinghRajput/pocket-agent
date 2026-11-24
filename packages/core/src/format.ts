type Unit = 'second' | 'minute' | 'hour' | 'day';

/**
 * "3 minutes ago", "in 2 hours", "yesterday": Intl.RelativeTimeFormat where the engine has it
 * (browsers); the same English words otherwise (React Native's Hermes has no RelativeTimeFormat).
 */
const rtf =
  typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function'
    ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    : {
        format(value: number, unit: Unit): string {
          if (unit === 'day' && value === -1) return 'yesterday';
          if (unit === 'day' && value === 1) return 'tomorrow';
          if (value === 0) return unit === 'day' ? 'today' : `this ${unit}`;
          const n = Math.abs(value);
          const words = `${n} ${unit}${n === 1 ? '' : 's'}`;
          return value < 0 ? `${words} ago` : `in ${words}`;
        },
      };

/** "just now", "12 seconds ago", "3 minutes ago", … */
export function timeAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never';
  const diff = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 5) return 'just now';
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86_400), 'day');
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Whole calendar days between `iso` and `now` (0 = today, 1 = yesterday). */
export function daysAgo(iso: string, now: number = Date.now()): number {
  return Math.round((startOfDay(now) - startOfDay(Date.parse(iso))) / 86_400_000);
}

/** "3:04 PM" — the time on a chat message. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Chat list stamp, like a messenger: time today, "Yesterday", weekday this week, else the date. */
export function chatListTime(iso: string, now: number = Date.now()): string {
  const d = daysAgo(iso, now);
  if (d <= 0) return clockTime(iso);
  if (d === 1) return 'Yesterday';
  if (d < 7) return new Date(iso).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
}

/** Day separator in a conversation: "Today", "Yesterday", "Fri, Nov 20". */
export function dayLabel(iso: string, now: number = Date.now()): string {
  const d = daysAgo(iso, now);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  const sameYear = new Date(iso).getFullYear() === new Date(now).getFullYear();
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "09:41" countdown */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface DatedSection<T> {
  label: 'Today' | 'Yesterday' | 'Last 7 days';
  items: T[];
}

/**
 * Splits a newest-first list into Today, Yesterday and Last 7 days (empty sections are left out),
 * plus everything earlier than that.
 */
export function recentSections<T extends { createdAt: string }>(
  items: T[],
  now: number = Date.now(),
): { sections: DatedSection<T>[]; earlier: T[] } {
  const today: T[] = [];
  const yesterday: T[] = [];
  const week: T[] = [];
  const earlier: T[] = [];
  for (const item of items) {
    const d = daysAgo(item.createdAt, now);
    (d <= 0 ? today : d === 1 ? yesterday : d < 7 ? week : earlier).push(item);
  }
  const all: DatedSection<T>[] = [
    { label: 'Today', items: today },
    { label: 'Yesterday', items: yesterday },
    { label: 'Last 7 days', items: week },
  ];
  return { sections: all.filter((x) => x.items.length > 0), earlier };
}

/** A file's size as people read it: 512 B, 84 KB, 3.2 MB. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
