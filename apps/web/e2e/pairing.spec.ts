// Full stack: browser ↔ real API ↔ real Local Agent CLI (DPAPI credentials, outbound WebSocket).
import { expect, test } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { API, registerViaApi } from './helpers';

const CLI = path.resolve(import.meta.dirname, '../../local-agent/dist/cli.js');

test.describe.configure({ mode: 'serial' });

function agentEnv() {
  return { ...process.env, AGENTDOCK_HOME: mkdtempSync(path.join(os.tmpdir(), 'agentdock-e2e-')) };
}

function startAgent(
  env: NodeJS.ProcessEnv,
): ChildProcess & { exited: Promise<number | null>; output: () => string } {
  const child = spawn(process.execPath, [CLI, 'start'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  child.stderr!.on('data', (d) => (out += d));
  const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
  return Object.assign(child, { exited, output: () => out });
}

test('pair a real Local Agent, watch it go online/offline, then revoke it', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-narrow', 'covered by the desktop and mobile projects');
  test.setTimeout(120_000);
  await registerViaApi(page.request, `Pairing ${info.project.name}`);
  const deviceName = `E2E PC ${info.project.name}`;
  const env = agentEnv();

  // 1. Dashboard issues a one-time code.
  await page.goto('/devices');
  await expect(page.getByText('No devices paired')).toBeVisible();
  await page.getByRole('button', { name: 'Add device' }).first().click();
  const code = (await page.getByTestId('pairing-code').textContent())!.trim();
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // 2. The PC pairs with it; the dialog notices on its own.
  const pairOut = execFileSync(process.execPath, [CLI, 'pair', code, '--api', API, '--name', deviceName], {
    env,
    encoding: 'utf8',
  });
  expect(pairOut).toContain('Paired');
  await expect(page.getByText('is paired')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Done' }).click();

  // The code is single-use.
  expect(() =>
    execFileSync(process.execPath, [CLI, 'pair', code, '--api', API], { env: agentEnv(), stdio: 'pipe' }),
  ).toThrow();

  const row = page.getByTestId('device-row').filter({ hasText: deviceName });
  const status = row.getByTestId('device-status');
  await expect(status).toHaveText('Offline');

  // 3. Agent connects → Online.
  let agent = startAgent(env);
  await expect(status).toHaveText('Online', { timeout: 20_000 });

  // 4. Agent process dies → Offline (well within the 45 s target).
  agent.kill();
  await agent.exited;
  await expect(status).toHaveText('Offline', { timeout: 20_000 });

  // 5. Back online after restart.
  agent = startAgent(env);
  await expect(status).toHaveText('Online', { timeout: 20_000 });

  // 6. Revoke from the dashboard → the live agent is cut off and exits.
  await row.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke device' }).click();
  await expect(status).toHaveText('Revoked');
  expect(await agent.exited).toBe(3);
  expect(agent.output()).toContain('revoked');

  // 7. Old credentials are gone and can't be used again.
  const st = JSON.parse(execFileSync(process.execPath, [CLI, 'status', '--json'], { env, encoding: 'utf8' }));
  expect(st).toMatchObject({ paired: false, revoked: true });
  const retry = startAgent(env);
  expect(await retry.exited).toBe(1);
});
