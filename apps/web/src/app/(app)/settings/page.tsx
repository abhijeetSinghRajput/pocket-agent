import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AccountSection } from '@/components/account-section';
import { PageHeader } from '@/components/page';
import { ThemeSelector } from '@/components/theme';
import { NotificationSettings } from '@/components/notifications/notification-settings';

export const metadata: Metadata = { title: 'Settings' };

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
    <section className="flex flex-col gap-3 py-5 first:pt-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="divide-y rounded-xl border bg-card px-5 py-5">
        <Section title="Theme" description="Choose how AgentDock looks on this device.">
          <ThemeSelector />
        </Section>
        <AccountSection />
        <Section
          title="Remote approval"
          description="Off by default. Enable it on each PC (agentdock approvals enable), then use Away mode under Devices for sessions you start yourself."
        >
          <Link
            href="/devices"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Devices
          </Link>
        </Section>
      </div>
      <section className="mt-6 rounded-xl border bg-card px-5 py-5" aria-labelledby="notifications-heading">
        <h2 id="notifications-heading" className="text-sm font-semibold">
          Notifications
        </h2>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">
          Push to this browser or installed app, per category, with quiet hours.
        </p>
        <NotificationSettings />
      </section>
    </>
  );
}
