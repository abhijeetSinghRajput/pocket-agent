import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page';
import { ThemeSelector } from '@/components/theme';
import { Badge } from '@/components/ui/badge';

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
        <Section title="Account" description="Name, email and password.">
          <Badge variant="accent">Arrives in M2</Badge>
        </Section>
        <Section
          title="Security"
          description="Active sessions, device credentials and remote-approval opt-in."
        >
          <Badge variant="accent">Arrives in M2–M5</Badge>
        </Section>
        <Section title="Notifications" description="Push categories, quiet hours and history.">
          <Badge variant="accent">Arrives in M6</Badge>
        </Section>
      </div>
    </>
  );
}
