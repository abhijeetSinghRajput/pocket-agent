import { ApiStatus } from '@/components/api-status';
import { DevicesSummary, GettingStarted } from '@/components/overview';
import { PageHeader } from '@/components/page';

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" description="Your agents, devices and pending approvals at a glance." />
      <div className="grid gap-4 md:grid-cols-2">
        <DevicesSummary />
        <GettingStarted />
        <ApiStatus />
      </div>
    </>
  );
}
