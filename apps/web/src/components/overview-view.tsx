'use client';

import { ApiStatus } from '@/components/api-status';
import { GettingStarted, OverviewStats, RecentActivity, useOverview } from '@/components/overview';
import { PageHeader } from '@/components/page';

export function OverviewView() {
  const state = useOverview();
  return (
    <>
      <PageHeader title="Overview" description="Your agents, devices and pending approvals at a glance." />
      <div className="flex flex-col gap-4">
        <OverviewStats state={state} />
        <div className="grid gap-4 md:grid-cols-[1fr_minmax(0,340px)]">
          <RecentActivity state={state} />
          <div className="flex flex-col gap-4">
            <GettingStarted state={state} />
            <ApiStatus />
          </div>
        </div>
      </div>
    </>
  );
}
