'use client';

import type { UserDto } from '@pocket-agent/protocol';
import Link from 'next/link';
import { cn } from '@/lib/utils';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0]![0]! + parts.at(-1)![0]! : (parts[0] ?? '?').slice(0, 2);
  return s.toUpperCase();
}

/** The signed-in user's picture (or initials). */
export function UserAvatar({ user, className }: { user: UserDto; className?: string }) {
  const url = (user as UserDto & { avatarUrl?: string | null }).avatarUrl;
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-primary text-[12px] font-semibold text-primary-foreground',
        className,
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote profile photo, no optimisation needed
        <img src={url} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
      ) : (
        initials(user.name)
      )}
    </span>
  );
}

/** Pages that belong to the profile (settings live inside it). */
export const PROFILE_ROUTES = ['/profile', '/notifications'];

/** The avatar, no label: opens the profile page. */
export function ProfileLink({
  user,
  active,
  className,
}: {
  user: UserDto;
  active: boolean;
  className?: string;
}) {
  return (
    <Link
      href="/profile"
      aria-label="Profile"
      title={user.name}
      aria-current={active ? 'page' : undefined}
      data-testid="profile-link"
      className={cn(
        'grid place-items-center rounded-full ring-offset-2 ring-offset-card outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active && 'ring-2 ring-primary',
        className,
      )}
    >
      <UserAvatar user={user} />
    </Link>
  );
}
