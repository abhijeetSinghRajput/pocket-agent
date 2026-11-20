// M5 full stack: a Claude Code permission request held by the real hook relay is decided in the
// browser; the relay hands the decision back to Claude Code.
import { expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { agentEnv, cli, hookPayloads, relay, RELAY, startAgent } from './agent';
import { API, registerViaApi } from './helpers';

test.describe.configure({ mode: 'serial' });

async function setup(page: Page, opts: { approvals: boolean }) {
  await registerViaApi(page.request, 'Approvals E2E');
  const env = agentEnv();
  const res = await page.request.post(`${API}/devices/pairing-codes`, {
    headers: { origin: 'http://localhost:3000' },
  });
  cli(env, 'pair', ((await res.json()) as { code: string }).code, '--api', API, '--name', 'E2E PC');
  cli(env, 'hooks', 'install');
  if (opts.approvals) cli(env, 'approvals', 'enable');
  const agent = startAgent(env);
  await expect.poll(() => agent.output()).toContain('Connected to');
  return { env, agent };
}

/** Starts the real relay for a hook without waiting (a held PermissionRequest blocks until decided). */
function relayAsync(env: { AGENTDOCK_HOME: string }, payload: object) {
  const child = spawn(process.execPath, [RELAY, '--agentdock-hook', '--home', env.AGENTDOCK_HOME]);
  let stdout = '';
  child.stdout.on('data', (d) => (stdout += d));
  const done = new Promise<string>((r) => child.on('exit', () => r(stdout)));
  child.stdin.end(JSON.stringify(payload));
  return done;
}

/** A tool call that needs permission, with its own id and command. */
function toolCall(h: ReturnType<typeof hookPayloads>, command: string) {
  const id = `toolu_${randomUUID().slice(0, 8)}`;
  const tool_input = { command, description: 'e2e' };
  return {
    pre: { ...h['PreToolUse']!, tool_use_id: id, tool_input },
    perm: { ...h['PermissionRequest']!, tool_input },
  };
}

test('in Away mode, a permission request is decided from the dashboard and reaches Claude Code', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(120_000);
  const { env, agent } = await setup(page, { approvals: true });
  const h = hookPayloads(randomUUID(), String.raw`C:\work\deploy-scripts`);
  relay(env, h['SessionStart']!);

  // Turn on Away mode for this PC.
  await page.goto('/devices');
  const away = page.getByTestId('away-switch');
  await expect(away).toHaveAttribute('aria-checked', 'false');
  await away.click();
  await expect(away).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => agent.output()).toContain('Away mode ON');

  // Claude asks for permission → the hook waits for the phone.
  const allowCall = toolCall(h, 'npm run deploy');
  relay(env, allowCall.pre);
  const allowed = relayAsync(env, allowCall.perm);

  await page.goto('/approvals');
  const card = page.getByTestId('approval-card').filter({ hasText: 'npm run deploy' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('deploy-scripts');
  await expect(page.getByTestId(isMobile ? 'pending-approvals-mobile' : 'pending-approvals')).toHaveText('1');
  await card.getByRole('button', { name: 'Allow' }).click();

  // The relay hands exactly "allow" back to Claude Code.
  expect(JSON.parse(await allowed)).toEqual({
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
  });
  const history = page.getByTestId('approval-history');
  await expect(history.locator('li').filter({ hasText: 'npm run deploy' })).toHaveAttribute(
    'data-status',
    'Approved',
  );

  // Deny works the same way and tells Claude why.
  const denyCall = toolCall(h, 'rm -rf build');
  relay(env, denyCall.pre);
  const denied = relayAsync(env, denyCall.perm);
  const denyCard = page.getByTestId('approval-card').filter({ hasText: 'rm -rf build' });
  await expect(denyCard).toBeVisible({ timeout: 15_000 });
  await denyCard.getByRole('button', { name: 'Deny' }).click();
  const denyOut = JSON.parse(await denied) as {
    hookSpecificOutput: { decision: { behavior: string; message: string } };
  };
  expect(denyOut.hookSpecificOutput.decision.behavior).toBe('deny');
  await expect(history.locator('li').filter({ hasText: 'rm -rf build' })).toHaveAttribute(
    'data-status',
    'Denied',
  );

  // Away mode off → requests are not held: Claude Code asks on the PC (relay answers nothing).
  await page.goto('/devices');
  await page.getByTestId('away-switch').click();
  await expect.poll(() => agent.output()).toContain('Away mode off');
  const localCall = toolCall(h, 'git push');
  relay(env, localCall.pre);
  expect(await relayAsync(env, localCall.perm)).toBe('');
  await page.goto('/approvals');
  await expect(page.getByTestId('approval-card')).toHaveCount(0);

  agent.kill();
  await agent.exited;
});

test('without the PC opt-in nothing is ever held, and the dashboard says how to enable it', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-agent', 'one project is enough');
  test.setTimeout(60_000);
  const { env, agent } = await setup(page, { approvals: false });
  await page.goto('/devices');
  await expect(page.getByTestId('remote-approval-off')).toContainText('agentdock approvals enable');
  await expect(page.getByTestId('away-switch')).toHaveCount(0);

  const h = hookPayloads(randomUUID(), String.raw`C:\work\other`);
  relay(env, h['SessionStart']!);
  const call = toolCall(h, 'npm publish');
  relay(env, call.pre);
  expect(await relayAsync(env, call.perm)).toBe('');
  agent.kill();
  await agent.exited;
});
