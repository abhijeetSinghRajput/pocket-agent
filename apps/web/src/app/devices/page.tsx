import { Laptop } from 'lucide-react';
import type { Metadata } from 'next';
import { NotYetAvailable, PageHeader } from '@/components/page';

export const metadata: Metadata = { title: 'Devices' };

export default function DevicesPage() {
  return (
    <>
      <PageHeader title="Devices" description="Computers running the AgentDock Local Agent." />
      <NotYetAvailable icon={Laptop} title="No devices paired" milestone="M2">
        <p>
          Pair a PC with a short one-time code. The Local Agent only connects outwards to AgentDock; nothing
          on your computer is exposed to the internet. You can revoke a device at any time.
        </p>
      </NotYetAvailable>
    </>
  );
}
