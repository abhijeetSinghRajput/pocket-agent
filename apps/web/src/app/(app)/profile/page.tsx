import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ApiStatus } from '@/components/api-status';
import { PageHeader } from '@/components/page';
import { InboxLink, ProfileHeader, SignOutButton } from '@/components/profile-view';
import { ThemeSelector } from '@/components/theme';
import { NotificationSettings } from '@/components/notifications/notification-settings';

export const metadata: Metadata = { title: 'Profile' };

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </section>
  );
}

/** The signed-in user, with every setting (on phones this is the only way to settings). */
export default function ProfilePage() {
  return (
    <>
      <PageHeader title="Profile" />
      <div className="flex flex-col gap-3">
        <ProfileHeader />
        <InboxLink />
        <section aria-labelledby="settings-heading">
          <h2
            id="settings-heading"
            className="mt-2 mb-1.5 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            Settings
          </h2>
          <div className="divide-y rounded-xl bg-card px-4">
            <Section
              title="Theme"
              description="Choose how Pocket Agent looks on this device. Press D to switch."
            >
              <ThemeSelector />
            </Section>
            <Section
              title="Remote approval"
              description="Off by default. Enable it on each PC (pocket-agent approvals enable), then use Away mode under Devices for sessions you start yourself."
            >
              <Link
                href="/devices"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Devices
              </Link>
            </Section>
          </div>
        </section>
        <section className="rounded-xl bg-card px-4 py-3.5" aria-labelledby="notifications-heading">
          <h2 id="notifications-heading" className="text-sm font-semibold">
            Notifications
          </h2>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">
            Push to this browser or installed app, per category, with quiet hours.
          </p>
          <NotificationSettings />
        </section>
        <ApiStatus />
        <SignOutButton />
      </div>
    </>
  );
}
