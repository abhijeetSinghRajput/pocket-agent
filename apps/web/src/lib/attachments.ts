'use client';

import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIME,
  AttachmentLinkResponse,
  AttachmentResponse,
  SignAttachmentResponse,
  type AttachmentRef,
} from '@pocket-agent/protocol';
import { apiBaseUrl, apiRequest } from '@/lib/api';

export const ATTACHMENT_ACCEPT = ATTACHMENT_MIME.join(',');

/** Why a file can't be attached, or null if it can. */
export function attachmentProblem(file: { type: string; size: number }): string | null {
  if (!(ATTACHMENT_MIME as readonly string[]).includes(file.type))
    return 'Only photos (PNG, JPEG, WebP, GIF) and PDFs can be attached.';
  if (file.size > ATTACHMENT_MAX_BYTES) return 'That file is larger than 10 MB.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

export const isPdf = (a: { mime: string }) => a.mime === 'application/pdf';

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Uploads one file: the API reserves it and signs the upload, the file goes straight to storage,
 * and the API then verifies it. Returns the attachment to send with a message.
 */
export async function uploadAttachment(file: File, signal?: AbortSignal): Promise<AttachmentRef> {
  const signed = await apiRequest('/attachments/sign', SignAttachmentResponse, {
    method: 'POST',
    body: { name: file.name || 'file', mime: file.type, size: file.size },
    ...(signal ? { signal } : {}),
  });
  const form = new FormData();
  for (const [k, v] of Object.entries(signed.fields)) form.set(k, v);
  form.set('file', file);
  let stored: { version?: unknown; signature?: unknown };
  try {
    const res = await fetch(signed.uploadUrl, { method: 'POST', body: form, ...(signal ? { signal } : {}) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    stored = (await res.json()) as typeof stored;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
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

/** The small preview the server keeps (also after the file itself was removed). */
export const thumbUrl = (id: string) => `${apiBaseUrl()}/attachments/${id}/thumb`;

/**
 * Opens the original file in a new tab. The tab is opened at once (so popup blockers allow it) and
 * pointed at a short-lived link; throws with the reason if the file can't be opened any more.
 */
export async function openAttachment(id: string): Promise<void> {
  const tab = window.open('about:blank', '_blank');
  try {
    const { url } = await apiRequest(`/attachments/${id}/link`, AttachmentLinkResponse);
    if (tab) {
      tab.opener = null;
      tab.location.replace(url);
    } else window.location.assign(url);
  } catch (err) {
    tab?.close();
    throw err;
  }
}
