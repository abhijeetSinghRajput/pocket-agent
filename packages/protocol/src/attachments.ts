import { z } from 'zod';
import { versionBelow } from './versions.js';

/**
 * Files sent with a message: photos, PDFs, documents, spreadsheets, code, anything a person would
 * hand Claude. Stored for 30 days; photos and PDFs keep a small preview after that.
 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Files per message. PC agents before 0.1.5 take at most 4 (see `attachmentLimit`). */
export const ATTACHMENT_MAX_PER_MESSAGE = 20;
export const MANY_FILES_AGENT_VERSION = '0.1.5';
const OLD_AGENT_MAX_FILES = 4;

/** How many files one message to this PC may carry (older agents reject more than 4). */
export function attachmentLimit(agentVersion: string | undefined): number {
  return !agentVersion || versionBelow(agentVersion, MANY_FILES_AGENT_VERSION)
    ? OLD_AGENT_MAX_FILES
    : ATTACHMENT_MAX_PER_MESSAGE;
}
export const ATTACHMENT_RETENTION_DAYS = 30;
/** Shown as a picture (and handed to Claude as one); PDFs too, as documents. */
export const PREVIEWABLE_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const;
/** Programs and installers are never accepted. */
export const BLOCKED_EXTENSIONS = [
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'pif',
  'cpl',
  'dll',
  'sys',
  'vbs',
  'vbe',
  'jse',
  'wsf',
  'wsh',
  'hta',
  'lnk',
  'reg',
  'apk',
  'appx',
  'msix',
  'dmg',
  'pkg',
  'app',
  'jar',
  'deb',
  'rpm',
  'iso',
  'img',
] as const;
export const AttachmentMime = z
  .string()
  .max(100)
  .regex(/^[\w.+-]+\/[\w.+-]+$/);
export type AttachmentMime = z.infer<typeof AttachmentMime>;

export const isPreviewable = (mime: string) => (PREVIEWABLE_MIME as readonly string[]).includes(mime);

/** The file's extension, lower case ('' if none). */
export function fileExtension(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name.trim());
  return m ? m[1]!.toLowerCase() : '';
}

/** Why this file can't be sent, or null if it can. */
export function attachmentProblem(file: { name: string; size: number }): string | null {
  if ((BLOCKED_EXTENSIONS as readonly string[]).includes(fileExtension(file.name)))
    return 'Programs and installers can’t be attached.';
  if (file.size > ATTACHMENT_MAX_BYTES) return 'That file is larger than 10 MB.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/** A file name as shown in the chat: no path, no control characters. */
export const AttachmentName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  // Path separators and control characters (code points below 32) become "_".
  .transform((n) => [...n].map((c) => (c === '/' || c === '\\' || c.charCodeAt(0) < 32 ? '_' : c)).join(''));

/** What travels with a message: enough to show it and to fetch it. Never the file itself. */
export const AttachmentRef = z.object({
  id: z.uuid(),
  name: z.string().max(200),
  mime: AttachmentMime,
  size: z.number().int().min(1).max(ATTACHMENT_MAX_BYTES),
});
export type AttachmentRef = z.infer<typeof AttachmentRef>;

export const AttachmentRefs = z.array(AttachmentRef).max(ATTACHMENT_MAX_PER_MESSAGE);

/** Step 1 of an upload: the API reserves the attachment and signs a direct upload to storage. */
export const SignAttachmentRequest = z.object({
  name: AttachmentName.refine(
    (n) => !attachmentProblem({ name: n, size: 1 }),
    'This kind of file can’t be attached',
  ),
  mime: AttachmentMime,
  size: z.number().int().min(1).max(ATTACHMENT_MAX_BYTES),
});
export type SignAttachmentRequest = z.infer<typeof SignAttachmentRequest>;

export const SignAttachmentResponse = z.object({
  attachment: AttachmentRef,
  /** POST the file here as multipart form data, with `fields` first and the file as `file`. */
  uploadUrl: z.url(),
  fields: z.record(z.string(), z.string()),
});
export type SignAttachmentResponse = z.infer<typeof SignAttachmentResponse>;

/** Step 2: what storage answered, so the API can verify the upload really happened. */
export const CompleteAttachmentRequest = z.object({
  version: z.number().int().positive(),
  signature: z.string().regex(/^[a-f0-9]{40}$/),
});
export type CompleteAttachmentRequest = z.infer<typeof CompleteAttachmentRequest>;

export const AttachmentLinkResponse = z.object({ url: z.url() });
export type AttachmentLinkResponse = z.infer<typeof AttachmentLinkResponse>;

export const AttachmentResponse = z.object({ attachment: AttachmentRef });
export type AttachmentResponse = z.infer<typeof AttachmentResponse>;

export const isPdf = (a: { mime: string }) => a.mime === 'application/pdf';
