import { Bot } from 'lucide-react';
import type { Metadata } from 'next';
import { NotYetAvailable, PageHeader } from '@/components/page';

export const metadata: Metadata = { title: 'Agents' };

export default function AgentsPage() {
  return (
    <>
      <PageHeader title="Agents" description="Coding-agent sessions running on your paired devices." />
      <NotYetAvailable icon={Bot} title="No agents yet" milestone="M3">
        <p>
          Sessions started by AgentDock are <strong className="font-medium text-foreground">managed</strong>:
          you can send instructions at any time and stop them. Sessions you start yourself in VS Code are{' '}
          <strong className="font-medium text-foreground">observed</strong>: you can monitor them and answer
          permission requests, and instructions are delivered only after Claude finishes its current turn.
        </p>
      </NotYetAvailable>
    </>
  );
}
