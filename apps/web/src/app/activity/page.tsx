import { Activity } from 'lucide-react';
import type { Metadata } from 'next';
import { NotYetAvailable, PageHeader } from '@/components/page';

export const metadata: Metadata = { title: 'Activity' };

export default function ActivityPage() {
  return (
    <>
      <PageHeader
        title="Activity"
        description="Sessions, tool runs, approvals and results across all agents."
      />
      <NotYetAvailable icon={Activity} title="No activity yet" milestone="M3">
        <p>Agent events stream here in real time once a paired PC reports its Claude Code sessions.</p>
      </NotYetAvailable>
    </>
  );
}
