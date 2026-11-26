import Image from 'next/image';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Claude Code's own Remote Control beside Pocket Agent, row by row. Facts about Remote Control are
 * from the Claude Code docs (code.claude.com/docs/en/remote-control): it needs a paid Claude plan
 * (Pro, Max, Ultra, Team or Enterprise), so every Remote Control feature is marked Paid. Keep them
 * current, and keep the rows where both do the same thing: the table is a fair one.
 */

const Paid = () => (
  <span className="ml-2 inline-flex h-5 items-center rounded-full bg-amber-500/15 px-2 align-[1px] text-[11px] font-semibold text-amber-700 dark:text-amber-300">
    Paid
  </span>
);

/** "Yes", with a green tick. */
const Yes = ({ children = 'Yes' }: { children?: ReactNode }) => (
  <span className="inline-flex items-start gap-1.5">
    <Check className="mt-[3px] size-4 shrink-0 text-success" strokeWidth={2.8} aria-hidden />
    <span>{children}</span>
  </span>
);

const ROWS: { label: string; rc: ReactNode; pa: ReactNode }[] = [
  {
    label: 'Made by',
    rc: 'Anthropic (built into Claude Code)',
    pa: 'Independent app (not affiliated with Anthropic)',
  },
  {
    label: 'Claude account',
    rc: (
      <>
        Pro, Max, Ultra, Team or Enterprise required
        <Paid />
      </>
    ),
    pa: 'Works with your existing Claude Code login, including API keys',
  },
  {
    label: 'Setup',
    rc: (
      <>
        Run <code>claude remote-control</code> or <code>/rc</code>
      </>
    ),
    pa: 'Install once; sessions appear automatically',
  },
  {
    label: 'After PC restart',
    rc: 'Claude process must be running again',
    pa: 'Starts at PC sign-in and reconnects automatically',
  },
  {
    label: 'Start new chats remotely',
    rc: (
      <>
        <Yes>Yes, while Remote Control is running</Yes>
        <Paid />
      </>
    ),
    pa: <Yes>Yes, in any permitted folder</Yes>,
  },
  {
    label: 'Approve commands',
    rc: (
      <>
        <Yes />
        <Paid />
      </>
    ),
    pa: <Yes />,
  },
  {
    label: 'Answer questions',
    rc: (
      <>
        <Yes />
        <Paid />
      </>
    ),
    pa: <Yes />,
  },
  {
    label: 'Push notifications',
    rc: (
      <>
        <Yes />
        <Paid />
      </>
    ),
    pa: <Yes />,
  },
  {
    label: 'Send photos and files',
    rc: (
      <>
        <Yes />
        <Paid />
      </>
    ),
    pa: <Yes />,
  },
  {
    label: 'Access control',
    rc: 'Admin restrictions for teams; optional trusted devices',
    pa: 'Per-PC phone approvals; folder-level access restrictions',
  },
  {
    label: 'Activity audit log',
    rc: 'Not mentioned in the docs',
    pa: <Yes>Yes, records every action</Yes>,
  },
  {
    label: 'Message storage',
    rc: 'Anthropic servers retain transcripts while connected',
    pa: 'Pocket Agent server stores session messages for your account',
  },
];

export function Comparison() {
  return (
    <div className="overflow-x-auto rounded-3xl border bg-card">
      <table className="w-full min-w-[680px] border-collapse text-left text-[15px]">
        <caption className="sr-only">Claude Code Remote Control vs Pocket Agent</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="w-[24%] px-6 py-5 font-semibold">
              Feature
            </th>
            <th scope="col" className="w-[38%] px-6 py-5 font-semibold">
              <span className="inline-flex items-center gap-2.5">
                <Image src="/logos/agents/claude-ai-icon.svg" alt="" width={22} height={22} />
                Claude Code Remote Control
              </span>
            </th>
            <th scope="col" className="w-[38%] bg-primary/8 px-6 py-5 font-semibold text-primary">
              <span className="inline-flex items-center gap-2.5">
                <Image src="/icons/logo-64.png" alt="" width={24} height={24} className="rounded-md" />
                Pocket Agent
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]">
          {ROWS.map(({ label, rc, pa }) => (
            <tr key={label} className="border-b last:border-b-0">
              <th scope="row" className="px-6 py-4 align-top font-medium">
                {label}
              </th>
              <td className="px-6 py-4 align-top text-pretty text-muted-foreground">{rc}</td>
              <td className="bg-primary/8 px-6 py-4 align-top text-pretty">{pa}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
