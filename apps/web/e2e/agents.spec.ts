// Full stack for M3: real hook relay → real Local Agent → real API → live browser updates.
// Claude Code itself is replaced by its recorded hook payloads (local-agent/test/fixtures).
import { SessionListResponse } from '@pocket-agent/protocol';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { agentEnv, cli, hookPayloads, relay, startAgent } from './agent';
import { API, chatStatus, closeSessionInfo, openSessionInfo, registerViaApi } from './helpers';

test.describe.configure({ mode: 'serial' });

async function pairedAgent(page: Page) {
  await registerViaApi(page.request, 'Agents E2E');
  const env = agentEnv();
  const code = (
    await (
      await page.request.post(`${API}/devices/pairing-codes`, {
        headers: { origin: 'http://localhost:3000' },
      })
    ).json()
  ).code as string;
  cli(env, 'pair', code, '--api', API, '--name', 'E2E PC');
  cli(env, 'hooks', 'install'); // into the isolated CLAUDE_CONFIG_DIR
  // Permission requests are answered on the PC here (approvals from the phone are on by default
  // and new PCs start in Away mode; approvals.spec covers that).
  cli(env, 'approvals', 'disable');
  return env;
}

async function sessionsFor(page: Page, externalSessionId: string) {
  const { sessions } = SessionListResponse.parse(
    await (await page.request.get(`${API}/sessions?scope=all`)).json(),
  );
  return sessions.filter((s) => s.externalSessionId === externalSessionId);
}

test('a Claude Code session streams into the dashboard live, survives a reconnect without duplicates', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const env = await pairedAgent(page);
  let agent = startAgent(env);

  const sid = randomUUID();
  const hooks = hookPayloads(sid, String.raw`C:\work\checkout-service`);

  await page.goto('/agents');
  await expect(page.getByText('No active chats')).toBeVisible();

  // Claude Code starts and receives a prompt → the card appears without reloading.
  await expect.poll(() => agent.output()).toContain('Connected to');
  relay(env, hooks['SessionStart']!);
  relay(env, hooks['UserPromptSubmit']!);
  const card = page.getByTestId('session-card').filter({ hasText: 'checkout-service' });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card.getByTestId('session-status')).toHaveAttribute('data-status', 'Running');
  await expect(card).toContainText('Run this exact bash command');

  // A tool needs permission → the card says so.
  relay(env, hooks['PreToolUse']!);
  relay(env, hooks['PermissionRequest']!);
  await expect(card.getByTestId('session-status')).toHaveAttribute('data-status', 'WaitingForPermission', {
    timeout: 10_000,
  });

  // The chat: honest capabilities (Session info) + live conversation.
  await card.click();
  await expect(page.getByRole('heading', { level: 1, name: 'checkout-service' })).toBeVisible();
  const caps = await openSessionInfo(page);
  await expect(caps.locator('[data-capability="Live status"]')).toHaveAttribute('data-state', 'yes');
  await expect(caps.locator('[data-capability="Send instructions"]')).toContainText('Turned off on this PC');
  await expect(caps.locator('[data-capability="Stop / interrupt"]')).toHaveAttribute('data-state', 'no');
  await closeSessionInfo(page);
  // The message box stays but is disabled, and says why.
  await expect(page.getByLabel('Send an instruction')).toBeDisabled();
  await expect(page.getByTestId('delivery-hint')).toContainText('pocket-agent instructions enable');
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toContainText('Permission requested: Bash');
  await expect(timeline).toContainText('echo pocket-agent-poc');

  relay(env, hooks['PostToolUse']!);
  relay(env, hooks['Stop']!);
  await expect(timeline).toContainText('Answered on the PC', { timeout: 10_000 });
  await expect(timeline.locator('[data-tool-state="done"]')).toContainText('Bash');
  await expect(timeline).toContainText('The command ran and printed');
  // The conversation scrolls inside the chat; the page itself never grows a scrollbar.
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 400, height: 420 });
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
  ).toBeLessThanOrEqual(0);
  await page.setViewportSize(size);
  await expect(chatStatus(page)).toHaveAttribute('data-status', 'WaitingForInput');

  // The PC drops → the session shows the PC is offline.
  agent.kill();
  await agent.exited;
  await expect(chatStatus(page)).toHaveAttribute('data-status', 'Disconnected', {
    timeout: 15_000,
  });

  // Back online; the same Claude session keeps reporting → still exactly one session.
  agent = startAgent(env);
  await expect.poll(() => agent.output()).toContain('Connected to');
  relay(env, hooks['UserPromptSubmit']!);
  await expect(chatStatus(page)).toHaveAttribute('data-status', 'Running', {
    timeout: 15_000,
  });
  expect(await sessionsFor(page, sid)).toHaveLength(1);

  // Session ends → leaves the Active list.
  relay(env, hooks['SessionEnd']!);
  await expect(chatStatus(page)).toHaveAttribute('data-status', 'Stopped', {
    timeout: 10_000,
  });
  await page.goto('/agents');
  await expect(page.getByText('No active chats')).toBeVisible();
  await page.getByRole('tab', { name: 'All' }).click();
  await expect(page.getByTestId('session-card').filter({ hasText: 'checkout-service' })).toBeVisible();

  agent.kill();
  await agent.exited;
});

test('sessions found without hooks are shown as status-only, never as controllable', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-agent', 'one project is enough');
  test.setTimeout(60_000);
  await registerViaApi(page.request, 'Discovery E2E');
  const env = agentEnv(); // no `hooks install`
  const code = (
    await (
      await page.request.post(`${API}/devices/pairing-codes`, {
        headers: { origin: 'http://localhost:3000' },
      })
    ).json()
  ).code as string;
  cli(env, 'pair', code, '--api', API, '--name', 'E2E PC');

  // A live Claude Code process registered in <config>/sessions (this test process stands in for it).
  const { writeFileSync } = await import('node:fs');
  const path = await import('node:path');
  const sid = randomUUID();
  writeFileSync(
    path.join(env.CLAUDE_CONFIG_DIR, 'sessions', `${process.pid}.json`),
    JSON.stringify({
      pid: process.pid,
      sessionId: sid,
      cwd: String.raw`C:\work\vs-code-project`,
      status: 'busy',
      kind: 'interactive',
      entrypoint: 'claude-vscode',
    }),
  );
  const agent = startAgent(env);

  await page.goto('/agents');
  const card = page.getByTestId('session-card').filter({ hasText: 'vs-code-project' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId('session-kind')).toHaveText('VS Code · status only');
  await card.click();
  const caps = await openSessionInfo(page);
  for (const c of ['Approve permissions remotely', 'Send instructions', 'Stop / interrupt']) {
    await expect(caps.locator(`[data-capability="${c}"]`)).toHaveAttribute('data-state', 'no');
  }
  await expect(caps).toContainText('pocket-agent hooks install');

  agent.kill();
  await agent.exited;
});
