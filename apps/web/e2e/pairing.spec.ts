// Full stack: browser ↔ real API ↔ real Local Agent CLI (DPAPI credentials, outbound WebSocket).
import { expect, test } from '@playwright/test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { agentEnv, CLI, startAgent } from './agent';
import { API, registerViaApi } from './helpers';

test.describe.configure({ mode: 'serial' });

test('pair a real Local Agent, watch it go online/offline, then revoke it', async ({ page }, info) => {
  test.setTimeout(120_000);
  await registerViaApi(page.request, `Pairing ${info.project.name}`);
  const deviceName = `E2E PC ${info.project.name}`;
  const env = agentEnv();

  // 1. A new account without a PC gets the setup screen (on any page) with a one-time code.
  await page.goto('/devices');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Let’s connect your PC.');
  await page.getByTestId('onboarding-connect').click();
  const code = (await page.getByTestId('pairing-code').textContent())!.trim();
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // 2. The PC pairs with it; the setup screen notices on its own.
  const pairOut = execFileSync(process.execPath, [CLI, 'pair', code, '--api', API, '--name', deviceName], {
    env,
    encoding: 'utf8',
  });
  expect(pairOut).toContain('Paired');
  await expect(page.getByTestId('onboarding-status')).toContainText(`${deviceName} found`, {
    timeout: 10_000,
  });

  // The code is single-use — and the CLI reports that cleanly (exit 1, no crash; this used to
  // crash on Windows with a libuv assertion when exiting with an open fetch connection).
  const reuse = spawnSync(process.execPath, [CLI, 'pair', code, '--api', API], {
    env: agentEnv(),
    encoding: 'utf8',
  });
  expect(reuse.status).toBe(1);
  expect(reuse.stderr).toContain('invalid or has expired');
  expect(reuse.stderr).not.toContain('Assertion failed');

  // 3. Agent connects → the setup screen says so, and the app opens.
  let agent = startAgent(env);
  await expect(page.getByTestId('onboarding-connected')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Set up your workspace' }).click();
  const row = page.getByTestId('device-row').filter({ hasText: deviceName });
  const status = row.getByTestId('device-status');
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

test('pair a real Local Agent by its QR code: approve on the web page it links to', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await registerViaApi(page.request, `QR ${info.project.name}`);
  const deviceName = `QR PC ${info.project.name}`;
  const env = agentEnv();

  // The PC asks for a pairing and shows the QR code, its link and a check code, then waits.
  const pc = spawn(process.execPath, [CLI, 'pair', '--api', API, '--name', deviceName], { env });
  let out = '';
  pc.stdout.on('data', (d: Buffer) => (out += d.toString()));
  pc.stderr.on('data', (d: Buffer) => (out += d.toString()));
  const exited = new Promise<number | null>((done) => pc.on('exit', done));
  await expect.poll(() => /Or open on your phone: (\S+)/.exec(out)?.[1], { timeout: 20_000 }).toBeTruthy();
  const link = new URL(/Or open on your phone: (\S+)/.exec(out)![1]!);
  const check = /Check code: (\S+)/.exec(out)![1]!.replace(/\x1b\[[0-9;]*m/g, '');

  // A new account (no PC yet) still reaches the approve page: it shows the PC and the same code.
  await page.goto(link.pathname);
  await expect(page.getByTestId('pair-approve')).toContainText(deviceName);
  await expect(page.getByTestId('pair-check')).toHaveText(check);
  await page.getByTestId('pair-approve-button').click();
  await expect(page.getByTestId('pair-done')).toBeVisible();

  // The PC collects its credentials and finishes.
  expect(await exited).toBe(0);
  expect(out).toContain('Paired');
  const st = JSON.parse(execFileSync(process.execPath, [CLI, 'status', '--json'], { env, encoding: 'utf8' }));
  expect(st).toMatchObject({ paired: true, deviceName });
});
