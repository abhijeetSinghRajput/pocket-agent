import type { Metadata } from 'next';
import { ApiStatus } from '@/components/api-status';
import { ClaudeUsageCard } from '@/components/claude-usage';
import { NotificationSettings } from '@/components/notifications/notification-settings';
import { ProfileHeader, SignOutButton } from '@/components/profile-view';
import { ThemeSelector } from '@/components/theme';

export const metadata: Metadata = { title: 'Profile' };

/** Who is signed in, their Claude plan usage, and the few settings there are. */
export default function ProfilePage() {
  return (
    <>
      <h1 className="sr-only">Profile</h1>
      <div className="stagger flex flex-col gap-3">
        <ProfileHeader />
        <ClaudeUsageCard />
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-4 py-3">
          <h2 className="text-sm font-medium">Theme</h2>
          <ThemeSelector />
        </section>
        <section className="rounded-xl bg-card p-4" aria-labelledby="notification-settings-heading">
          <h2
            id="notification-settings-heading"
            className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            Notifications
          </h2>
          <NotificationSettings />
        </section>
        <ApiStatus />
        <SignOutButton />
      </div>
    </>
  );
}
