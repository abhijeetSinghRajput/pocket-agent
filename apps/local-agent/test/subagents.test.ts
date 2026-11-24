import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSubagents, readSubagents } from '../src/providers/claude-code/subagents.js';

const SESSION = '11111111-2222-3333-4444-555555555555';

/** A Claude config folder with one session that started a sub-agent, which started another. */
function fixture() {
  const config = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-subagents-'));
  const dir = path.join(config, 'projects', 'c--work-app', SESSION, 'subagents');
  mkdirSync(dir, { recursive: true });
  const write = (id: string, meta: object, entries: Array<object | string>) => {
    writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
    writeFileSync(
      path.join(dir, `agent-${id}.jsonl`),
      entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n',
    );
  };
  const at = (s: number) => new Date(Date.UTC(2026, 10, 24, 10, 0, s)).toISOString();
  write(
    'aaa',
    {
      agentType: 'Explore',
      description: 'Find the upload code',
      toolUseId: 'toolu_root',
      spawnDepth: 1,
      model: 'claude-opus-5-5',
      finished: true,
    },
    [
      { type: 'user', timestamp: at(0), message: { role: 'user', content: 'Find where uploads happen.' } },
      {
        type: 'user',
        isMeta: true,
        timestamp: at(0),
        message: { role: 'user', content: '<system-reminder>…' },
      },
      {
        type: 'assistant',
        timestamp: at(1),
        message: {
          content: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'text', text: 'Searching.' },
            { type: 'tool_use', id: 'toolu_grep', name: 'Bash', input: { command: 'grep -r upload src' } },
          ],
        },
      },
      {
        type: 'user',
        timestamp: at(2),
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_grep', content: 'src/upload.ts:1' }],
        },
      },
      {
        type: 'assistant',
        timestamp: at(3),
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_child',
              name: 'Agent',
              input: { description: 'Read it', prompt: 'Read src/upload.ts' },
            },
          ],
        },
      },
      {
        type: 'user',
        timestamp: at(4),
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_child',
              is_error: true,
              content: [{ type: 'text', text: 'boom' }],
            },
          ],
        },
      },
      'not json at all',
    ],
  );
  write(
    'bbb',
    {
      agentType: 'general-purpose',
      description: 'Read it',
      toolUseId: 'toolu_child',
      spawnDepth: 2,
      requestShape: 'background',
      finished: false,
    },
    [
      { type: 'user', timestamp: at(3), message: { role: 'user', content: 'Read src/upload.ts' } },
      {
        type: 'assistant',
        timestamp: at(5),
        message: {
          content: [{ type: 'tool_use', id: 'toolu_test', name: 'Bash', input: { command: 'npm test' } }],
        },
      },
    ],
  );
  return config;
}

describe('sub-agents read from Claude Code’s records', () => {
  it('lists every sub-agent with who started it', async () => {
    const found = await listSubagents(SESSION, fixture());
    expect(found!.agents).toMatchObject([
      {
        agentId: 'aaa',
        toolUseId: 'toolu_root',
        parentToolUseId: null,
        type: 'Explore',
        depth: 1,
        finished: true,
        toolCalls: 2,
      },
      {
        agentId: 'bbb',
        toolUseId: 'toolu_child',
        parentToolUseId: 'toolu_root',
        depth: 2,
        background: true,
        finished: false,
      },
    ]);
  });

  it('says what a running sub-agent is doing now (the tool call it waits on)', async () => {
    const [done, running] = (await listSubagents(SESSION, fixture()))!.agents;
    expect(done!.current).toBeNull();
    expect(running!.current).toEqual({ toolName: 'Bash', input: expect.stringContaining('npm test') });
  });

  it('turns a transcript into session events: prompt, replies, tool calls and their results', async () => {
    const r = await readSubagents(SESSION, 'toolu_root', fixture());
    if ('error' in r) throw new Error(r.error);
    expect(r.events.map((e) => e.eventType)).toEqual([
      'agent.output', // the prompt (the reminder Claude Code adds is left out)
      'agent.output',
      'agent.tool.started',
      'agent.tool.completed',
      'agent.tool.started',
      'agent.tool.failed',
    ]);
    expect(r.events[0]!.payload).toEqual({ role: 'user', text: 'Find where uploads happen.' });
    expect(r.events[3]!.payload).toMatchObject({ toolName: 'Bash', output: 'src/upload.ts:1' });
    expect(r.events[5]!.payload).toMatchObject({ toolName: 'Agent', error: 'boom' });
    expect(r.truncated).toBe(false);
  });

  it('says what is missing, and never reads outside the config folder', async () => {
    const config = fixture();
    expect(await readSubagents(SESSION, 'toolu_nope', config)).toEqual({ error: 'agent_not_found' });
    expect(await readSubagents('99999999-0000-0000-0000-000000000000', 'x', config)).toEqual({
      error: 'conversation_not_found',
    });
    expect(await readSubagents('../../etc', 'x', config)).toEqual({ error: 'conversation_not_found' });
  });
});
