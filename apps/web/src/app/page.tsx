import { ApiStatus } from '@/components/api-status';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const SETUP = [
  {
    title: 'Create your account',
    detail: 'Sign in so your devices and agents are private to you.',
    milestone: 'M2',
  },
  { title: 'Pair this PC', detail: 'Run the Local Agent and enter a short pairing code.', milestone: 'M2' },
  {
    title: 'Connect Claude Code',
    detail: 'See managed and VS Code sessions live on this dashboard.',
    milestone: 'M3',
  },
  {
    title: 'Control from your phone',
    detail: 'Send instructions and approve permissions remotely.',
    milestone: 'M4–M5',
  },
] as const;

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" description="Your agents, devices and pending approvals at a glance." />
      <div className="grid gap-4 md:grid-cols-2">
        <ApiStatus />
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Getting started</CardTitle>
              <CardDescription className="mt-1.5">
                Agent and device stats appear here once a PC is paired.
              </CardDescription>
            </div>
          </CardHeader>
          <ol className="flex flex-col gap-3">
            {SETUP.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium">{step.title}</span>
                    <Badge>{step.milestone}</Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
