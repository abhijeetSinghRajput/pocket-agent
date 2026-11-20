'use client';

import { ApiStatus } from '@/components/api-status';
import { GettingStarted, OverviewStats, useOverview } from '@/components/overview';
import { PageHeader } from '@/components/page';

export function OverviewView() {
  const state = useOverview();
  return (
    <>
      <PageHeader title="Overview" description="Your agents, devices and pending approvals at a glance." />
      <div className="flex flex-col gap-4">
        <OverviewStats state={state} />
        <div className="grid items-start gap-4 md:grid-cols-2">
          <GettingStarted state={state} />
          <ApiStatus />
        </div>
      </div>
    </>
  );
}
