import type { Metadata } from 'next';
import { PairApprove } from '@/components/devices/pair-approve';

export const metadata: Metadata = { title: 'Connect a PC' };

export default function PairPage() {
  return <PairApprove />;
}
