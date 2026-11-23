import type { AskedQuestion } from '@pocket-agent/core';
import { ApprovalResponse, type ApprovalDto, type DecideApprovalRequest } from '@pocket-agent/protocol';
import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';
import type { Tone } from '@/ui/core';

/** Status words and tones, the same as the web app's approvals (its "neutral" is our "muted"). */
export const APPROVAL_STATUS: Record<ApprovalDto['status'], { label: string; tone: Tone }> = {
  Pending: { label: 'Waiting', tone: 'warning' },
  Approved: { label: 'Allowed', tone: 'success' },
  Denied: { label: 'Denied', tone: 'danger' },
  Expired: { label: 'Expired', tone: 'muted' },
  Cancelled: { label: 'Answered elsewhere', tone: 'muted' },
};

/** What the request is, in plain words. */
export function describeRequest(tool: string): { verb: string; label: string; shell: boolean } {
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return { verb: 'run a command', label: 'Command', shell: true };
    case 'Write':
      return { verb: 'create or overwrite a file', label: 'File', shell: false };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { verb: 'edit a file', label: 'File', shell: false };
    case 'WebFetch':
      return { verb: 'open a web page', label: 'URL', shell: false };
    case 'AskUserQuestion':
      return { verb: 'ask you a question', label: 'Question', shell: false };
    default:
      return { verb: `use ${tool}`, label: 'Details', shell: false };
  }
}

/** Tools the PC only describes by argument names (MCP and unknown tools): show them as a list. */
export function readableInput(input: string): string {
  try {
    const v = JSON.parse(input) as Record<string, unknown>;
    const args = v['arguments'];
    if (Array.isArray(args) && Object.keys(v).length === 1) {
      return args.length ? `Arguments: ${args.join(', ')}` : 'No arguments';
    }
    return JSON.stringify(v, null, 2);
  } catch {
    return input;
  }
}

/** Milliseconds left until `expiresAt`, ticking once a second (negative once it has passed). */
export function useCountdown(expiresAt: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Date.parse(expiresAt) - now;
}

/** Under a minute the countdown turns urgent. */
export const SHORT_MS = 60_000;

/** What the user picked for one question: option labels, and/or their own words. */
export interface Pick {
  labels: string[];
  other: string;
}
export const NO_PICK: Pick = { labels: [], other: '' };

/** The answer Claude receives: labels (comma-separated for several), or the user's own words. */
export function answerText(q: AskedQuestion, pick: Pick | undefined): string {
  const p = pick ?? NO_PICK;
  const other = p.other.trim();
  // Keep Claude's option order, whatever order they were tapped in.
  const labels = q.options.map((o) => o.label).filter((l) => p.labels.includes(l));
  return [...labels, ...(other ? [other] : [])].join(', ');
}

/** What the PC is told when a question is skipped. */
export const SKIP_MESSAGE = 'The user skipped this question.';

/**
 * Sends a decision. Errors carry the server's own words (expired, already answered, PC offline…)
 * and are shown as they are.
 */
export function sendDecision(approvalId: string, body: DecideApprovalRequest): Promise<ApprovalResponse> {
  return apiRequest(`/approvals/${approvalId}/decision`, ApprovalResponse, { method: 'POST', body });
}

export type Decision = DecideApprovalRequest['decision'];

/** The footer line once a decision has gone out: the PC still has to confirm it. */
export function sentText(sent: Decision, answering: boolean): string {
  if (answering) {
    return sent === 'allow'
      ? 'Answer sent. Waiting for your PC to confirm…'
      : 'Skipped. Waiting for your PC to confirm…';
  }
  return `${sent === 'allow' ? 'Allowed' : 'Denied'} — waiting for your PC to confirm…`;
}

/** What happens if nobody decides before the countdown ends. */
export function timeoutText(mode: ApprovalDto['sessionMode']): string {
  return mode === 'managed'
    ? 'If nobody decides in time, it is denied.'
    : 'If nobody decides in time, Claude Code asks on your PC instead.';
}
