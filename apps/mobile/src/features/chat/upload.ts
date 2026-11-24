import {
  attachmentProblem as protocolProblem,
  AttachmentResponse,
  SignAttachmentResponse,
  type AttachmentRef,
} from '@pocket-agent/protocol';
import { File, UploadType } from 'expo-file-system';
import { uuid } from 'expo-modules-core';
import { apiRequest } from '@/lib/api';

export { fileSize } from '@pocket-agent/core';

/** A file picked on the phone, before and while it uploads. */
export interface PickedFile {
  uri: string;
  name: string;
  mime: string;
  size: number;
}

/** A file picked in the composer, while it uploads and until it is sent. */
export interface DraftFile {
  key: string;
  file: PickedFile;
  status: 'uploading' | 'ready' | 'error';
  /** 0..1 while uploading. */
  progress?: number;
  ref?: AttachmentRef;
  /** When the upload finished (a draft keeps it for less than the server does). */
  uploadedAt?: number;
  error?: string;
}

/** A fresh id (idempotency keys, draft keys): RFC 4122 v4. */
export const newId = (): string => uuid.v4();

/** Why a file can't be attached, or null if it can (the same check the server makes). */
export const attachmentProblem = (file: { name: string; size: number }) => protocolProblem(file);

/** The type to declare for a file the phone can't name (code, Markdown…). */
export const mimeOf = (mime: string | null | undefined) => mime || 'application/octet-stream';

export const isImage = (file: { mime: string }) => file.mime.startsWith('image/');

const BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
};

/** The MIME type for a picked file: what the picker said, else a guess from its name. */
export function guessMime(name: string, given?: string | null): string {
  if (given) return given;
  const ext = /\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1]?.toLowerCase();
  return mimeOf(ext ? BY_EXTENSION[ext] : undefined);
}

/** The last path segment of a URI, as the file's name when the picker gave none. */
export function nameFromUri(uri: string, fallback = 'file'): string {
  const last = uri.split('?')[0]!.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last) || fallback;
  } catch {
    return last || fallback;
  }
}

/** The file's size when the picker didn't report one (0 if it can't be read). */
export function sizeOf(uri: string, given?: number | null): number {
  if (typeof given === 'number' && given > 0) return given;
  try {
    return new File(uri).size;
  } catch {
    return 0;
  }
}

const isAbort = (err: unknown) => (err as Error | undefined)?.name === 'AbortError';

/**
 * Uploads one file: the API reserves it and signs the upload, the file goes straight to storage,
 * and the API then verifies it. Returns the attachment to send with a message.
 */
export async function uploadAttachment(
  file: PickedFile,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<AttachmentRef> {
  const signed = await apiRequest('/attachments/sign', SignAttachmentResponse, {
    method: 'POST',
    body: { name: file.name || 'file', mime: file.mime, size: file.size },
    ...(signal ? { signal } : {}),
  });
  let stored: { version?: unknown; signature?: unknown };
  try {
    // Multipart: the signed fields first, then the file as `file` (what storage expects).
    const res = await new File(file.uri).upload(signed.uploadUrl, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: file.mime,
      parameters: signed.fields,
      ...(signal ? { signal } : {}),
      ...(onProgress
        ? { onProgress: (p) => onProgress(p.totalBytes > 0 ? Math.min(1, p.bytesSent / p.totalBytes) : 0) }
        : {}),
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    stored = JSON.parse(res.body) as typeof stored;
  } catch (err) {
    if (isAbort(err) || signal?.aborted) {
      const abort = new Error('Aborted');
      abort.name = 'AbortError';
      throw abort;
    }
    throw new Error('The upload failed. Check your connection and try again.');
  }
  const done = await apiRequest(`/attachments/${signed.attachment.id}/complete`, AttachmentResponse, {
    method: 'POST',
    body: { version: stored.version, signature: stored.signature },
    ...(signal ? { signal } : {}),
  });
  return done.attachment;
}

/**
 * A file taken out of the message box before sending: delete it now (best effort; the server also
 * sweeps uploads that were never sent, after an hour).
 */
export async function discardAttachment(id: string): Promise<void> {
  await apiRequest(`/attachments/${id}`, null, { method: 'DELETE' }).catch(() => undefined);
}
