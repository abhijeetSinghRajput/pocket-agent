import {
  ATTACHMENT_MAX_BYTES,
  AttachmentResponse,
  deviceAuthHeader,
  SignAttachmentResponse,
  isPreviewable,
  type AttachmentRef,
} from '@pocket-agent/protocol';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** A file sent from the app, downloaded to this PC. */
export interface LocalFile {
  ref: AttachmentRef;
  /** Where it was saved (for Claude's Read tool when the message can only carry text). */
  path: string;
  data: Buffer;
}

/** A file the user attached in the editor, read from the session transcript. */
export interface PastedFile {
  mime: string;
  data: Buffer;
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

/** A file name that is safe on any OS and can't leave its folder. */
export function safeFileName(name: string, mime: string): string {
  const base = path
    .basename(name.replace(/\\/g, '/'))
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .slice(0, 80);
  const own = /\.([A-Za-z0-9]{1,10})$/.exec(base)?.[1]?.toLowerCase();
  const ext = EXT[mime] ?? own ?? 'bin';
  const stem = base.replace(/\.[A-Za-z0-9]{1,10}$/, '') || 'file';
  return `${stem}.${ext}`;
}

/** What Claude is told when the message can only carry text (a turn running in the editor). */
export function filesNote(files: LocalFile[]): string {
  if (!files.length) return '';
  const list = files.map((f) => `- ${f.path} (${f.ref.mime})`).join('\n');
  return `\n\nThe user attached ${files.length === 1 ? 'this file' : 'these files'} to the message. ${
    files.length === 1 ? 'It is' : 'They are'
  } saved on this PC; open ${files.length === 1 ? 'it' : 'them'} from there (Read works for text and code):\n${list}`;
}

/**
 * Message content for a turn Pocket Agent runs through the SDK: the files themselves (images as
 * images, PDFs as documents), then the text.
 */
const TEXT_EXT = new Set([
  'md',
  'markdown',
  'txt',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'toml',
  'ini',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'ps1',
  'sql',
  'graphql',
  'vue',
  'svelte',
  'log',
  'env',
  'svg',
]);
/** Pictures and PDFs, together, up to this size go into the message itself (base64 adds a third). */
const INLINE_MEDIA_MAX = 18 * 1024 * 1024;
/** Text files up to this size go into the message itself. */
const INLINE_TEXT_MAX = 200_000;

/** A file whose content is plain text (by type or extension), small enough to hand over as text. */
export function inlineText(f: LocalFile): string | null {
  const ext = /\.([A-Za-z0-9]{1,10})$/.exec(f.ref.name)?.[1]?.toLowerCase() ?? '';
  const textual = f.ref.mime.startsWith('text/') || TEXT_EXT.has(ext);
  if (!textual || f.data.length > INLINE_TEXT_MAX) return null;
  const text = f.data.toString('utf8');
  return text.includes('�') ? null : text; // not really text
}

/** The folder a message's files were saved in (granted to Claude for that turn). */
export const filesDir = (files: LocalFile[] | undefined) =>
  files?.length ? path.dirname(files[0]!.path) : undefined;

/**
 * Message content for a turn Pocket Agent runs through the SDK: pictures and PDFs as themselves,
 * text and code as their content, and any other file (a spreadsheet, a document) saved on this PC
 * and named, in a folder Claude may read for this turn.
 */
export function messageContent(text: string, files: LocalFile[] | undefined) {
  if (!files?.length) return text;
  // Pictures and PDFs go in as themselves while the request stays well under the API's size
  // limit; past that they are saved and named, and Claude opens them with Read.
  let budget = INLINE_MEDIA_MAX;
  const shown = files.filter((f) => {
    if (!isPreviewable(f.ref.mime) || f.data.length > budget) return false;
    budget -= f.data.length;
    return true;
  });
  const inline = files
    .filter((f) => !shown.includes(f) && !isPreviewable(f.ref.mime))
    .map((f) => ({ f, content: inlineText(f) }))
    .filter((x): x is { f: LocalFile; content: string } => x.content !== null);
  const saved = files.filter((f) => !shown.includes(f) && !inline.some((x) => x.f === f));
  return [
    ...shown.map((f) =>
      f.ref.mime === 'application/pdf'
        ? ({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: f.data.toString('base64') },
          } as const)
        : ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: f.ref.mime as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
              data: f.data.toString('base64'),
            },
          } as const),
    ),
    ...inline.map(
      ({ f, content }) =>
        ({
          type: 'text',
          text: `<attached-file name="${f.ref.name.replace(/"/g, '')}">
${content}
</attached-file>`,
        }) as const,
    ),
    { type: 'text', text: text + filesNote(saved) } as const,
  ];
}

/** Fetches files the app sent, and uploads files attached on this PC, through the Pocket Agent API. */
export class AttachmentClient {
  constructor(
    private readonly opts: {
      apiUrl: string;
      deviceId: string;
      secret: string;
      /** Downloads are kept under `<home>/attachments/<message id>/`. */
      home: string;
      fetch?: typeof fetch;
    },
  ) {}

  private get auth() {
    return { authorization: deviceAuthHeader(this.opts.deviceId, this.opts.secret) };
  }
  private get http() {
    return this.opts.fetch ?? fetch;
  }

  /** Downloads every attachment of a message. Throws if any can't be fetched (the message then fails). */
  async download(messageId: string, refs: AttachmentRef[]): Promise<LocalFile[]> {
    const dir = path.join(this.opts.home, 'attachments', messageId.replace(/[^A-Za-z0-9-]/g, ''));
    await mkdir(dir, { recursive: true });
    const out: LocalFile[] = [];
    for (const [i, ref] of refs.entries()) {
      // The API answers with a short-lived link to storage; the device credentials stay with the API.
      const res = await this.http(`${this.opts.apiUrl}/agent/attachments/${ref.id}/file`, {
        headers: this.auth,
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      });
      const link = res.headers.get('location');
      if (res.status !== 302 || !link) throw new Error(`attachment ${ref.name}: HTTP ${res.status}`);
      const file = await this.http(link, { signal: AbortSignal.timeout(60_000) });
      if (!file.ok) throw new Error(`attachment ${ref.name}: storage HTTP ${file.status}`);
      const data = Buffer.from(await file.arrayBuffer());
      if (!data.length || data.length > ATTACHMENT_MAX_BYTES)
        throw new Error(`attachment ${ref.name}: bad size`);
      const target = path.join(dir, `${i + 1}-${safeFileName(ref.name, ref.mime)}`);
      await writeFile(target, data);
      out.push({ ref, path: target, data });
    }
    return out;
  }

  /** Uploads a file attached in the editor so the app can show it. */
  async upload(file: PastedFile, name: string): Promise<AttachmentRef> {
    const json = { ...this.auth, 'content-type': 'application/json' };
    const signRes = await this.http(`${this.opts.apiUrl}/agent/attachments/sign`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name, mime: file.mime, size: file.data.length }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!signRes.ok) throw new Error(`sign: HTTP ${signRes.status}`);
    const signed = SignAttachmentResponse.parse(await signRes.json());

    const form = new FormData();
    for (const [k, v] of Object.entries(signed.fields)) form.set(k, v);
    form.set('file', new Blob([new Uint8Array(file.data)], { type: file.mime }), name);
    const up = await this.http(signed.uploadUrl, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!up.ok) throw new Error(`upload: HTTP ${up.status}`);
    const stored = (await up.json()) as { version?: unknown; signature?: unknown };

    const done = await this.http(`${this.opts.apiUrl}/agent/attachments/${signed.attachment.id}/complete`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ version: stored.version, signature: stored.signature }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!done.ok) throw new Error(`complete: HTTP ${done.status}`);
    return AttachmentResponse.parse(await done.json()).attachment;
  }
}
