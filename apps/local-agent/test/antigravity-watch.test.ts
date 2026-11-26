import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AntigravityWatcher, type ListedSession } from '../src/providers/antigravity/watch.js';
import { SessionRegistry } from '../src/sessions/registry.js';

type Json = Record<string, unknown>;
const A = '45ad29d4-dda7-40cc-a6e0-22fdeaca6c98';
const OURS = '5877e4d6-bedf-407a-9760-5b87409076fa';

function harness() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-agy-conv-'));
  let now = Date.now();
  const events: Json[] = [];
  const registry = new SessionRegistry((e) => events.push(e as unknown as Json));
  let lists = 0;
  const listed: ListedSession[] = [
    { sessionId: A, cwd: 'C:/work/api', title: 'Fix the build' },
    { sessionId: OURS, cwd: 'C:/work/api', title: 'From the phone' },
  ];
  const watcher = new AntigravityWatcher(registry, {
    dir,
    isOurs: (id) => id === OURS,
    list: async () => {
      lists++;
      return listed;
    },
    now: () => now,
  });
  /** Antigravity wrote to a chat's files at the watcher's "now". */
  const touch = (id: string, wal = false) => {
    const f = path.join(dir, `${id}.db${wal ? '-wal' : ''}`);
    writeFileSync(f, 'x');
    utimesSync(f, new Date(now), new Date(now));
  };
  const of = (type: string) => events.filter((e) => e['eventType'] === type).map((e) => e['payload'] as Json);
  return { watcher, registry, touch, of, later: (ms: number) => (now += ms), lists: () => lists, dir };
}

describe('Antigravity chats started in the terminal (status only)', () => {
  it('shows one that changes as working, then waiting; title and folder from Antigravity’s list', async () => {
    const h = harness();
    h.later(1000);
    h.touch(A, true);
    await h.watcher.scan();
    expect(h.registry.get(A)).toMatchObject({
      provider: 'antigravity',
      mode: 'observed',
      projectPath: 'C:/work/api',
      status: 'Running',
      capabilities: { remoteApproval: false, instructAnytime: false, interrupt: false },
      metadata: { entrypoint: 'cli', watch: 'status', name: 'Fix the build' },
    });
    h.later(30_000);
    await h.watcher.scan();
    expect(h.registry.get(A)?.status).toBe('WaitingForInput');
    h.touch(A);
    await h.watcher.scan();
    expect(h.registry.get(A)?.status).toBe('Running');
    expect(h.lists()).toBe(1); // asked once
    expect(h.of('agent.output')).toHaveLength(0); // never its messages
  });

  it('leaves Pocket Agent’s own chats alone, and chats that last changed before it started', async () => {
    const h = harness();
    h.touch(A); // written when the watcher started: not news
    h.later(1000);
    h.touch(OURS);
    await h.watcher.scan();
    expect(h.registry.live()).toHaveLength(0);
  });

  it('a chat quiet for 30 minutes has ended', async () => {
    const h = harness();
    h.later(1000);
    h.touch(A);
    await h.watcher.scan();
    h.later(31 * 60_000);
    await h.watcher.scan();
    expect(h.registry.get(A)).toBeUndefined();
    expect(h.of('agent.session.ended')).toEqual([{ externalSessionId: A, reason: 'idle' }]);
  });
});

describe('a chat Pocket Agent brought back after a restart', () => {
  it('stays the phone’s chat even while its Antigravity still writes (never "terminal")', async () => {
    const h = harness();
    // Restored as waiting by the new PC agent (a managed chat), its files still changing.
    h.registry.announce(
      {
        externalSessionId: A,
        provider: 'antigravity',
        mode: 'managed',
        projectPath: 'C:/work/api',
        status: 'WaitingForInput',
        capabilities: {
          monitor: true,
          remoteApproval: false,
          instructAnytime: true,
          instructBetweenTurns: true,
          interrupt: true,
        },
      },
      'managed',
    );
    h.later(1000);
    h.touch(A);
    await h.watcher.scan();
    expect(h.registry.get(A)?.mode).toBe('managed');
    expect(h.registry.get(A)?.metadata?.['watch']).toBeUndefined();
  });
});
