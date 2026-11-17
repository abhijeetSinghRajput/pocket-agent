import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { NotYetAvailable, PageHeader } from '@/components/page';

export const metadata: Metadata = { title: 'Approvals' };

export default function ApprovalsPage() {
  return (
    <>
      <PageHeader title="Approvals" description="Permission requests waiting for your decision." />
      <NotYetAvailable icon={ShieldCheck} title="No pending approvals" milestone="M5">
        <p>
          Remote approval is off by default and must be turned on per device. AgentDock never changes your
          Claude Code permission settings: if a request is not answered here in time, it falls back to the
          prompt on your PC. Every decision is recorded in an audit log.
        </p>
      </NotYetAvailable>
    </>
  );
}
