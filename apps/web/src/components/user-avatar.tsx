'use client';

import type { UserDto } from '@pocket-agent/protocol';
import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0]![0]! + parts.at(-1)![0]! : (parts[0] ?? '?').slice(0, 2);
  return s.toUpperCase();
}

/** The signed-in user's picture (or initials). */
export function UserAvatar({ user, className }: { user: UserDto; className?: string }) {
  // The picture Google gave us (its own letter avatar when the account has no photo). If it is
  // missing or doesn't load, our initials.
  const [failed, setFailed] = useState<string | null>(null);
  const url = user.avatarUrl && user.avatarUrl !== failed ? user.avatarUrl : null;
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
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
          className="size-full object-cover"
        />
      ) : (
        initials(user.name)
      )}
    </span>
  );
}

/** Pages that belong to the profile (settings live inside it). */
export const PROFILE_ROUTES = ['/profile'];

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
        'grid place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
    >
      {/* The ring sits on the picture itself: no gap between them. */}
      <UserAvatar user={user} className={active ? 'ring-2 ring-foreground' : undefined} />
    </Link>
  );
}

/** Sidebar: the whole row is the profile link (picture, name, email). */
export function ProfileRow({ user, active }: { user: UserDto; active: boolean }) {
  return (
    <Link
      href="/profile"
      aria-label={`Profile: ${user.name}`}
      aria-current={active ? 'page' : undefined}
      data-testid="profile-link"
      className={cn(
        'flex items-center gap-2.5 rounded-lg p-2 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active && 'bg-accent',
      )}
    >
      <UserAvatar user={user} />
      <span className="min-w-0">
        <span className="block truncate text-sm leading-tight font-medium">{user.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
      </span>
    </Link>
  );
}
