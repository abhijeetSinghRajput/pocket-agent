import { createEvent, type AttachmentRef, type BackendToAgent } from '@pocket-agent/protocol';
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AttachmentClient,
  filesNote,
  messageContent,
  safeFileName,
  type LocalFile,
} from '../src/attachments.js';
import { CommandRouter } from '../src/command-router.js';
import type { Policy } from '../src/policy.js';
import { ClaudeHookHandler } from '../src/providers/claude-code/hooks.js';
import { ObservedInstructions } from '../src/providers/claude-code/instructions.js';
import { ManagedSessions, type QueryFn } from '../src/providers/claude-code/managed.js';
import { TranscriptTail } from '../src/providers/claude-code/transcript.js';
import { IdleWake } from '../src/providers/claude-code/wake.js';
import { SessionRegistry, type SessionEventOut } from '../src/sessions/registry.js';

const PNG = Buffer.from('iVBORw0KGgo=', 'base64');
const ref = (over: Partial<AttachmentRef> = {}): AttachmentRef => ({
  id: crypto.randomUUID(),
  name: 'home page.png',
  mime: 'image/png',
  size: PNG.length,
  ...over,
});
const tmp = () => mkdtempSync(path.join(tmpdir(), 'pa-att-'));

describe('files sent from the app', () => {
  it('saves under a safe name that can’t leave its folder', () => {
    expect(safeFileName('../../.ssh/id_rsa', 'image/png')).toBe('id_rsa.png');
    expect(safeFileName('C:\\Users\\me\\shot.final.PNG', 'image/png')).toBe('shot.final.png');
    expect(safeFileName('résumé?.pdf', 'application/pdf')).toBe('r_sum__.pdf');
    expect(safeFileName('', 'image/jpeg')).toBe('file.jpg');
  });

  it('downloads through the API’s short-lived link, never sending device credentials to storage', async () => {
    const home = tmp();
    const calls: Array<{ url: string; auth: string | null }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
      if (url.includes('/agent/attachments/'))
        return new Response(null, { status: 302, headers: { location: 'https://storage.test/f1' } });
      return new Response(new Uint8Array(PNG));
    }) as typeof fetch;
    const client = new AttachmentClient({
      apiUrl: 'https://api.test',
      deviceId: 'd1',
      secret: 's1',
      home,
      fetch: fake,
    });
    const r = ref();
    const [file] = await client.download('cmd-1', [r]);
    expect(file!.path).toBe(path.join(home, 'attachments', 'cmd-1', '1-home page.png'));
    expect(readFileSync(file!.path)).toEqual(PNG);
    expect(calls[0]!.auth).toContain('PocketAgent-Device');
    expect(calls[1]).toEqual({ url: 'https://storage.test/f1', auth: null });
  });

  it('fails the whole message if a file can’t be fetched', async () => {
    const fake = (async () => new Response(null, { status: 404 })) as typeof fetch;
    const client = new AttachmentClient({
      apiUrl: 'https://api.test',
      deviceId: 'd',
      secret: 's',
      home: tmp(),
      fetch: fake,
    });
    await expect(client.download('c', [ref()])).rejects.toThrow(/HTTP 404/);
  });

  it('gives Claude the files themselves in turns Pocket Agent runs, or their paths when only text can be sent', () => {
    const files: LocalFile[] = [
      { ref: ref(), path: 'C:\\pa\\1-shot.png', data: PNG },
      { ref: ref({ mime: 'application/pdf', name: 'spec.pdf' }), path: 'C:\\pa\\2-spec.pdf', data: PNG },
    ];
    expect(messageContent('look', undefined)).toBe('look');
    expect(messageContent('look', files)).toMatchObject([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } },
      { type: 'document', source: { media_type: 'application/pdf' } },
      { type: 'text', text: 'look' },
    ]);
    const note = filesNote(files);
    expect(note).toContain('C:\\pa\\1-shot.png (image/png)');
    expect(note).toContain('Read works for text and code');
    // A file Claude can't take in directly (a spreadsheet, code) is saved and named in the text.
    const sheet: LocalFile = {
      ref: ref({ mime: 'text/csv', name: 'sales.csv' }),
      path: 'C:/pa/3-sales.csv',
      data: Buffer.from('a,b'),
    };
    const doc: LocalFile = {
      ref: ref({
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        name: 'brief.docx',
      }),
      path: 'C:/pa/4-brief.docx',
      data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe]),
    };
    // Text and code go in as their content; a document is saved and named.
    const mixed = messageContent('look', [files[0]!, sheet, doc]) as Array<{ type: string; text?: string }>;
    expect(mixed.map((b) => b.type)).toEqual(['image', 'text', 'text']);
    expect(mixed[1]!.text).toContain('<attached-file name="sales.csv">');
    expect(mixed[1]!.text).toContain('a,b');
    expect(mixed[2]!.text).toContain('4-brief.docx');
    expect(mixed[2]!.text).not.toContain('sales.csv');
    expect(safeFileName('notes.md', 'application/octet-stream')).toBe('notes.md');
  });
});

type Exec = Extract<BackendToAgent, { eventType: 'command.execute' }>;
function harness(download: (id: string, refs: AttachmentRef[]) => Promise<LocalFile[]>) {
  const events: SessionEventOut[] = [];
  const acks: Array<{ id: string; status: string; extra?: Record<string, unknown> }> = [];
  const ack = (id: string, status: string, extra?: Record<string, unknown>) =>
    acks.push({ id, status, ...(extra ? { extra } : {}) });
  const registry = new SessionRegistry((e) => events.push(e));
  const prompts: unknown[] = [];
  const sdk: QueryFn = (args) =>
    (async function* (): AsyncGenerator<SDKMessage> {
      for await (const m of args.prompt as AsyncIterable<SDKUserMessage>) {
        prompts.push(m.message.content);
        yield { type: 'result', subtype: 'success' } as SDKMessage;
      }
    })() as unknown as Query & { options?: Options };
  const managed = new ManagedSessions(registry, sdk, () => undefined, ack as never);
  const observed = new ObservedInstructions(registry, ack as never);
  const wake = new IdleWake(registry, sdk, ack as never);
  const policy: Policy = {
    projects: [],
    observedInstructions: true,
    wakeIdle: true,
    shareAttachments: false,
    remoteApproval: false,
  };
  const router = new CommandRouter({
    registry,
    managed,
    observed,
    wake,
    attachments: { download },
    policy: () => policy,
    ack: ack as never,
  });
  const hooks = new ClaudeHookHandler(registry, managed.isManaged, {
    instructions: observed,
    instructionsAllowed: () => true,
    wakeIdleAllowed: () => true,
    wake,
  });
  hooks.handle({
    session_id: 'obs',
    hook_event_name: 'SessionStart',
    cwd: 'C:\\work\\app',
    source: 'startup',
  });
  const send = (attachments: AttachmentRef[]) => {
    const c = createEvent(
      'command.execute',
      {
        commandId: crypto.randomUUID(),
        commandType: 'instruction',
        text: 'What is this?',
        attachments,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      { sessionId: 'obs' },
    ) as unknown as Exec;
    return router.handle(c).then(() => c.payload.commandId);
  };
  return { send, prompts, acks, hooks, events };
}

describe('a message with files reaches Claude', () => {
  const r = ref();
  const file: LocalFile = { ref: r, path: 'C:\\pa\\1-shot.png', data: PNG };

  it('idle session (woken): the image is in the message itself', async () => {
    const h = harness(async () => [file]);
    await h.send([r]);
    await new Promise((res) => setTimeout(res, 20));
    expect(h.prompts[0]).toMatchObject([
      { type: 'text' }, // the app context (first woken turn)
      { type: 'image' },
      { type: 'text', text: 'What is this?' },
    ]);
    // The chat shows what the user wrote, not the file bytes.
    const echo = h.events
      .filter((e) => e.eventType === 'agent.output')
      .map((e) => (e.payload as { text: string }).text);
    expect(echo).toEqual(['What is this?']);
  });

  it('busy session (hook): Claude is told where the file was saved; the chat still shows only the text', async () => {
    const h = harness(async () => [file]);
    const base = { session_id: 'obs', cwd: 'C:\\work\\app' };
    h.hooks.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'working' });
    await h.send([r]);
    const out = h.hooks.handle({
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 't1',
      tool_input: {},
    }) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toContain('What is this?');
    expect(out.hookSpecificOutput.additionalContext).toContain('C:\\pa\\1-shot.png');
    const echo = h.events
      .filter((e) => e.eventType === 'agent.output')
      .map((e) => (e.payload as { text: string }).text);
    expect(echo).toEqual(['working', 'What is this?']);
  });

  it('a failed download fails the message; nothing is sent to Claude', async () => {
    const h = harness(async () => {
      throw new Error('storage HTTP 500');
    });
    const id = await h.send([r]);
    expect(h.acks.filter((a) => a.id === id).at(-1)).toMatchObject({
      status: 'Failed',
      extra: { error: 'attachment_download_failed' },
    });
    expect(h.prompts).toHaveLength(0);
  });
});

describe('files attached in the editor', () => {
  let n = 0;
  const line = (o: Record<string, unknown>) => JSON.stringify({ uuid: `u${++n}`, ...o }) + '\n';
  const image = {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') },
  };
  const prompt = line({ type: 'user', message: { content: [image, { type: 'text', text: 'see this' }] } });
  // An image Claude read with a tool is not something the user attached.
  const toolResult = line({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't', content: [image] }] },
  });
  const file = () => {
    const p = path.join(tmp(), 's.jsonl');
    writeFileSync(p, '');
    return p;
  };

  it('are read from the transcript only when sharing is on, and never from tool results', () => {
    const p = file();
    const t = new TranscriptTail();
    t.attach('s', p);
    appendFileSync(p, prompt + toolResult);
    expect(t.read('s')).toEqual([]); // sharing off: not even parsed

    const p2 = file();
    t.attach('s2', p2);
    appendFileSync(p2, prompt + toolResult);
    const out = t.read('s2', true);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'files', files: [{ mime: 'image/png' }] });
  });

  it('are uploaded and attached to the chat only with the PC owner’s opt-in', async () => {
    for (const allowed of [false, true]) {
      const events: SessionEventOut[] = [];
      const registry = new SessionRegistry((e) => events.push(e));
      const uploaded: string[] = [];
      const shared = ref({ name: 'attachment-1.png' });
      const h = new ClaudeHookHandler(registry, () => false, {
        shareFilesAllowed: () => allowed,
        shareFiles: async (files) => {
          uploaded.push(...files.map((f) => f.mime));
          return [shared];
        },
      });
      const p = file();
      const base = { session_id: 's1', cwd: 'C:\\app', transcript_path: p };
      h.handle({ ...base, hook_event_name: 'SessionStart', source: 'startup' });
      h.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'see this' });
      appendFileSync(p, prompt);
      h.handle({ ...base, hook_event_name: 'Stop' });
      await new Promise((r) => setTimeout(r, 20));
      const withFiles = events.filter(
        (e) => e.eventType === 'agent.output' && (e.payload as { attachments?: unknown[] }).attachments,
      );
      expect(uploaded).toEqual(allowed ? ['image/png'] : []);
      expect(withFiles).toHaveLength(allowed ? 1 : 0);
      if (allowed)
        expect(withFiles[0]!.payload).toMatchObject({ role: 'user', text: '', attachments: [shared] });
    }
  });
});
