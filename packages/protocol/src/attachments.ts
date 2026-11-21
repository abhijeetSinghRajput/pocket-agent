import { z } from 'zod';

/** Photos and PDFs sent with a message. Stored for 30 days; a small preview is kept after that. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_PER_MESSAGE = 4;
export const ATTACHMENT_RETENTION_DAYS = 30;
export const ATTACHMENT_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const;
export const AttachmentMime = z.enum(ATTACHMENT_MIME);
export type AttachmentMime = z.infer<typeof AttachmentMime>;

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
  name: AttachmentName,
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
