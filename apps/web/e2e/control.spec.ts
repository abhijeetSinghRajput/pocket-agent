// M4 full stack: instructions typed in the browser reach a Claude Code session through the real
// API → Local Agent → hook relay path (Stop hook delivery), with live command status.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { agentEnv, cli, hookPayloads, RELAY, startAgent } from './agent';
import { API, registerViaApi } from './helpers';

test.describe.configure({ mode: 'serial' });

async function pairedAgent(page: Page, opts: { instructions: boolean }) {
  await registerViaApi(page.request, 'Control E2E');
  const env = agentEnv();
  const res = await page.request.post(`${API}/devices/pairing-codes`, {
    headers: { origin: 'http://localhost:3000' },
  });
  cli(env, 'pair', ((await res.json()) as { code: string }).code, '--api', API, '--name', 'E2E PC');
  cli(env, 'hooks', 'install');
  if (opts.instructions) cli(env, 'instructions', 'enable');
  return env;
}

/** Runs the real relay like Claude Code does and returns what it printed (the hook's answer). */
function hook(env: { POCKET_AGENT_HOME: string }, payload: object): string {
  return execFileSync(process.execPath, [RELAY, '--pocket-agent-hook', '--home', env.POCKET_AGENT_HOME], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

test('an instruction from the dashboard reaches a session the user started, at the end of its turn', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const env = await pairedAgent(page, { instructions: true });
  const agent = startAgent(env);
  await expect.poll(() => agent.output()).toContain('Connected to');

  const h = hookPayloads(randomUUID(), String.raw`C:\work\billing`);
  hook(env, h['SessionStart']!);
  hook(env, h['UserPromptSubmit']!);

  await page.goto('/agents');
  await page.getByTestId('session-card').filter({ hasText: 'billing' }).click();
  await expect(
    page.getByTestId('capabilities').locator('[data-capability="Send instructions"]'),
  ).toHaveAttribute('data-state', 'yes');
  await expect(page.getByTestId('delivery-hint')).toContainText('when Claude finishes its current turn');

  // Send from the "phone".
  await page.getByLabel('Send an instruction').fill('Also update the changelog');
  await page.getByRole('button', { name: 'Send' }).click();
  const row = page.getByTestId('command-row').filter({ hasText: 'Also update the changelog' });
  await expect(row).toHaveAttribute('data-status', 'Accepted');
  await expect(row).toContainText('Queued');

  // Claude finishes its turn → the Stop hook answers with the instruction (same session continues).
  const answer = JSON.parse(hook(env, h['Stop']!)) as { decision: string; reason: string };
  expect(answer.decision).toBe('block');
  expect(answer.reason).toContain('Also update the changelog');
  await expect(row).toHaveAttribute('data-status', 'Executing');
  await expect(row).toContainText('Claude is working on it');
  await expect(page.getByTestId('session-status')).toHaveAttribute('data-status', 'Running');

  // Next Stop: that turn is done, nothing more to deliver.
  expect(hook(env, h['Stop']!)).toBe('');
  await expect(row).toHaveAttribute('data-status', 'Completed');
  await expect(page.getByTestId('timeline')).toContainText('Also update the changelog');

  // PC goes offline → a new instruction fails immediately and says why.
  agent.kill();
  await agent.exited;
  await expect(page.getByTestId('session-status')).toHaveAttribute('data-status', 'Disconnected', {
    timeout: 15_000,
  });
  await page.getByLabel('Send an instruction').fill('Are you there?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('send-error')).toHaveText('Your PC is offline. Nothing was sent.');
  await expect(page.getByTestId('command-row').filter({ hasText: 'Are you there?' })).toHaveAttribute(
    'data-status',
    'Failed',
  );
});

test('without the PC owner’s consent, sessions they started cannot be instructed', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-agent', 'one project is enough');
  test.setTimeout(60_000);
  const env = await pairedAgent(page, { instructions: false });
  const agent = startAgent(env);
  await expect.poll(() => agent.output()).toContain('Connected to');
  const h = hookPayloads(randomUUID(), String.raw`C:\work\payroll`);
  hook(env, h['SessionStart']!);

  await page.goto('/agents');
  await page.getByTestId('session-card').filter({ hasText: 'payroll' }).click();
  const instruct = page.getByTestId('capabilities').locator('[data-capability="Send instructions"]');
  await expect(instruct).toHaveAttribute('data-state', 'no');
  await expect(instruct).toContainText('pocket-agent instructions enable');
  await expect(page.getByTestId('composer')).toHaveCount(0);
  // The Stop hook never answers either.
  expect(hook(env, h['Stop']!)).toBe('');

  // New session: no project allowed on the PC yet → the dialog explains how to allow one.
  await page.goto('/agents');
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.getByTestId('no-projects')).toContainText('pocket-agent projects add');

  agent.kill();
  await agent.exited;
});
