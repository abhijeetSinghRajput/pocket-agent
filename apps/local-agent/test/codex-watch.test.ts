import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CodexWatcher, commandsOf, patchFiles } from '../src/providers/codex/watch.js';
import { SessionRegistry } from '../src/sessions/registry.js';

type Json = Record<string, unknown>;

/** A Codex home with today's sessions folder, and a watcher on it. */
function harness(opts: { managed?: string[] } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-codex-home-'));
  let now = Date.now();
  const d = new Date(now);
  const day = path.join(
    home,
    String(d.getFullYear()),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  );
  mkdirSync(day, { recursive: true });
  const events: Json[] = [];
  const registry = new SessionRegistry((e) => events.push(e as unknown as Json));
  const watcher = new CodexWatcher(registry, {
    dir: home,
    isManaged: (id) => (opts.managed ?? []).includes(id),
    idleEndMs: 60_000,
    now: () => now,
  });
  const file = (id: string) => path.join(day, `rollout-2026-11-26T10-00-00-${id}.jsonl`);
  const write = (id: string, lines: Json[]) =>
    appendFileSync(file(id), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  const of = (type: string) => events.filter((e) => e['eventType'] === type).map((e) => e['payload'] as Json);
  return { watcher, registry, write, file, of, events, later: (ms: number) => (now += ms) };
}

const meta = (id: string, extra: Json = {}) => ({
  type: 'session_meta',
  payload: {
    id,
    cwd: 'C:\\work\\api',
    originator: 'codex_cli_rs',
    source: 'cli',
    cli_version: '0.172.0',
    ...extra,
  },
});
const ev = (payload: Json) => ({ type: 'event_msg', payload });
const item = (type: string, text: string) =>
  ev({ type: 'item_completed', item: { type, id: `i-${text}`, content: [{ type: 'Text', text }] } });
const resp = (payload: Json) => ({ type: 'response_item', payload });

describe('Codex chats started on the PC (followed from Codex’s session files)', () => {
  it('shows a terminal chat as watch-only, with its messages, commands and status', async () => {
    const h = harness();
    h.write('t1', [
      meta('t1'),
      ev({ type: 'task_started', turn_id: 'u1' }),
      // Codex's own context message is not the user's.
      resp({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '<environment_context>' }],
      }),
      item('UserMessage', 'fix the build'),
    ]);
    await h.watcher.scan();
    expect(h.registry.get('t1')).toMatchObject({
      provider: 'codex',
      mode: 'observed',
      projectPath: 'C:\\work\\api',
      status: 'Running',
      capabilities: { remoteApproval: false, instructAnytime: false, interrupt: false },
      metadata: { entrypoint: 'cli', transcript: 'watched' },
    });

    h.write('t1', [
      resp({
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'c1',
        input: 'const r = await tools.exec_command({cmd:"npm test",shell:"powershell"}); text(r.output);',
      }),
      resp({
        type: 'custom_tool_call_output',
        call_id: 'c1',
        output: [{ type: 'input_text', text: '3 passed' }],
      }),
      resp({
        type: 'custom_tool_call',
        name: 'apply_patch',
        call_id: 'c2',
        input:
          '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-SECRET\n+NEW\n*** Add File: src/b.ts\n+BODY\n*** End Patch',
      }),
      resp({ type: 'custom_tool_call_output', call_id: 'c2', output: 'Done' }),
      item('AgentMessage', 'Fixed: the build passes.'),
      ev({ type: 'task_complete', last_agent_message: 'Fixed: the build passes.' }),
    ]);
    await h.watcher.scan();
    expect(h.of('agent.output').map((o) => [o['role'], o['text']])).toEqual([
      ['user', 'fix the build'],
      ['assistant', 'Fixed: the build passes.'],
    ]);
    const tools = h.of('agent.tool.completed');
    expect(tools.map((t) => t['toolName'])).toEqual(['Bash', 'Edit', 'Write']);
    expect(String(tools[0]!['input'])).toContain('npm test');
    expect(String(tools[0]!['output'])).toContain('3 passed');
    expect(String(tools[1]!['input'])).toContain('src/a.ts');
    expect(JSON.stringify(h.events)).not.toContain('SECRET');
    expect(h.registry.get('t1')?.status).toBe('WaitingForInput');
  });

  it('a command that failed shows as failed', async () => {
    const h = harness();
    h.write('f1', [
      meta('f1'),
      resp({
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'c1',
        input: 'tools.exec_command({cmd:"rm x"})',
      }),
      resp({
        type: 'custom_tool_call_output',
        call_id: 'c1',
        output: [{ type: 'input_text', text: 'Script failed\nWall time 0.1 seconds' }],
      }),
    ]);
    await h.watcher.scan();
    expect(h.of('agent.tool.failed')).toHaveLength(1);
    expect(h.of('agent.tool.completed')).toHaveLength(0);
  });

  it('a VS Code chat says so; a failed turn says why', async () => {
    const h = harness();
    h.write('v1', [
      meta('v1', { source: 'vscode', originator: 'codex_vscode' }),
      ev({ type: 'task_started' }),
      ev({ type: 'task_complete', error: { message: 'usage limit reached' } }),
    ]);
    await h.watcher.scan();
    expect(h.registry.get('v1')?.metadata).toMatchObject({ entrypoint: 'codex-vscode' });
    expect(h.of('agent.error')).toEqual([{ message: 'usage limit reached' }]);
    expect(h.registry.get('v1')?.status).toBe('Failed');
  });

  it('leaves Pocket Agent’s own chats alone (by originator, or running here)', async () => {
    const h = harness({ managed: ['m1'] });
    h.write('own', [
      meta('own', { originator: 'pocket-agent', source: 'vscode' }),
      item('UserMessage', 'hi'),
    ]);
    h.write('m1', [meta('m1'), item('UserMessage', 'hi')]);
    await h.watcher.scan();
    expect(h.registry.live()).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it('picks up a line written in two parts once it is whole', async () => {
    const h = harness();
    h.write('p1', [meta('p1')]);
    const line = JSON.stringify(item('UserMessage', 'half and half')) + '\n';
    appendFileSync(h.file('p1'), line.slice(0, 20));
    await h.watcher.scan();
    expect(h.of('agent.output')).toHaveLength(0);
    appendFileSync(h.file('p1'), line.slice(20));
    await h.watcher.scan();
    expect(h.of('agent.output')).toEqual([{ role: 'user', text: 'half and half' }]);
  });

  it('a chat with no news for a while has ended; an old file is not news', async () => {
    const h = harness();
    h.write('q1', [meta('q1'), ev({ type: 'task_complete' })]);
    await h.watcher.scan();
    expect(h.registry.get('q1')).toBeDefined();
    h.later(61_000);
    await h.watcher.scan();
    expect(h.registry.get('q1')).toBeUndefined();
    expect(h.of('agent.session.ended')).toEqual([{ externalSessionId: 'q1', reason: 'idle' }]);
    // Written long ago (by the clock): not picked up again.
    writeFileSync(h.file('old'), JSON.stringify(meta('old')) + '\n');
    h.later(60 * 60_000);
    await h.watcher.scan();
    expect(h.registry.get('old')).toBeUndefined();
  });

  it('finds commands in shell calls and code, and files in patches', () => {
    expect(commandsOf('shell', JSON.stringify({ command: ['git', 'status'] }))).toEqual(['git status']);
    expect(commandsOf('exec_command', JSON.stringify({ cmd: 'ls -la' }))).toEqual(['ls -la']);
    expect(
      commandsOf(
        'exec',
        'await tools.exec_command({cmd:"a \\"b\\""}); await tools.exec_command({cmd:\'c\'})',
      ),
    ).toEqual(['a "b"', 'c']);
    expect(patchFiles('*** Delete File: x.ts\n*** Add File: y.ts')).toEqual([
      { path: 'x.ts', added: false },
      { path: 'y.ts', added: true },
    ]);
  });
});
