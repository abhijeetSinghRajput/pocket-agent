import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_RETENTION_DAYS,
  fileExtension,
  isPreviewable,
  type AttachmentRef,
  type SignAttachmentRequest,
} from '@pocket-agent/protocol';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context.js';
import type { Attachment } from '../generated/prisma/client.js';
import { ALLOWED_FORMATS, type AttachmentStorage, type StoredAs } from './storage.js';

/** An upload that no message carries is deleted after this long. */
export const UNUSED_AFTER_MS = 60 * 60 * 1000;

/** How a file is stored: photos and PDFs as images, everything else as a plain file. */
export const storedAs = (mime: string): StoredAs => (isPreviewable(mime) ? 'image' : 'raw');

export type AttachmentServices = AppContext & { storage: AttachmentStorage | null };

/** Who an attachment belongs to: a user, and the PC that uploaded it (if a PC did). */
export interface Owner {
  userId: string;
  deviceId?: string;
}

export const toRef = (a: Pick<Attachment, 'id' | 'name' | 'mime' | 'size'>): AttachmentRef => ({
  id: a.id,
  name: a.name,
  mime: a.mime as AttachmentRef['mime'],
  size: a.size,
});

export class AttachmentError extends Error {
  constructor(
    readonly code: 'attachments_disabled' | 'not_found' | 'upload_not_verified' | 'too_large' | 'removed',
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function storageOf(ctx: AttachmentServices): AttachmentStorage {
  if (!ctx.storage)
    throw new AttachmentError('attachments_disabled', 'Attachments are not set up on this server.', 404);
  return ctx.storage;
}

/** Reserves an attachment for `owner` and signs a direct upload for it. */
export async function signAttachment(ctx: AttachmentServices, owner: Owner, input: SignAttachmentRequest) {
  const storage = storageOf(ctx);
  // Random storage id: nothing about the user or the file name is in the URL. A plain file keeps
  // its extension (storage serves it under its id).
  const ext = fileExtension(input.name);
  const as = storedAs(input.mime);
  const publicId = `pocket-agent/${randomUUID()}${as === 'raw' && ext ? `.${ext}` : ''}`;
  const a = await ctx.prisma.attachment.create({
    data: {
      userId: owner.userId,
      deviceId: owner.deviceId ?? null,
      name: input.name,
      mime: input.mime,
      size: input.size,
      publicId,
    },
  });
  return { attachment: toRef(a), ...storage.signUpload(publicId, as) };
}

/**
 * Confirms the upload with storage (signature, real size and type). The preview is made after
 * answering, so the phone isn't kept waiting for it (the thumb route makes it if asked first).
 */
export async function completeAttachment(
  ctx: AttachmentServices,
  owner: Owner,
  id: string,
  result: { version: number; signature: string },
): Promise<AttachmentRef> {
  const storage = storageOf(ctx);
  const a = await ctx.prisma.attachment.findFirst({
    where: { id, userId: owner.userId, deviceId: owner.deviceId ?? null },
  });
  if (!a) throw new AttachmentError('not_found', 'Not found', 404);
  if (a.readyAt) return toRef(a);
  if (!storage.verifyUpload(a.publicId, result.version, result.signature))
    throw new AttachmentError('upload_not_verified', 'The upload could not be verified.');

  const as = storedAs(a.mime);
  const info = await storage.info(a.publicId, as);
  if (!info) throw new AttachmentError('upload_not_verified', 'The upload could not be verified.');
  if (info.bytes > ATTACHMENT_MAX_BYTES || (as === 'image' && !ALLOWED_FORMATS.includes(info.format))) {
    await storage.destroy(a.publicId, as).catch(() => undefined);
    await ctx.prisma.attachment.delete({ where: { id: a.id } });
    throw new AttachmentError('too_large', 'That file is too large or not a supported type.');
  }
  const ready = await ctx.prisma.attachment.update({
    where: { id: a.id },
    data: { readyAt: ctx.now(), size: info.bytes },
  });
  if (as === 'image') void attachmentThumb(ctx, a.userId, a.id).catch(() => undefined);
  return toRef(ready);
}

/**
 * The small preview kept in our database, made on first need (right after the upload, or when it
 * is first shown). It stays after the file itself was removed. Null if there is none to show.
 */
export async function attachmentThumb(
  ctx: AttachmentServices,
  userId: string,
  id: string,
): Promise<Buffer | null> {
  const a = await ctx.prisma.attachment.findFirst({
    where: { id, userId, readyAt: { not: null } },
    select: { thumb: true, publicId: true, mime: true, removedAt: true },
  });
  if (!a) return null;
  if (a.thumb) return Buffer.from(a.thumb);
  if (a.removedAt || storedAs(a.mime) !== 'image' || !ctx.storage) return null;
  const thumb = await ctx.storage.thumbnail(a.publicId, a.mime).catch(() => null);
  if (!thumb) return null;
  await ctx.prisma.attachment.updateMany({
    where: { id, thumb: null },
    data: { thumb: new Uint8Array(thumb) },
  });
  return thumb;
}

/** The user's attachments with these ids, all uploaded and still stored; undefined if any is not. */
export async function ownedAttachments(
  ctx: AppContext,
  userId: string,
  ids: string[],
): Promise<AttachmentRef[] | undefined> {
  const unique = [...new Set(ids)];
  const rows = await ctx.prisma.attachment.findMany({
    where: { id: { in: unique }, userId, readyAt: { not: null }, removedAt: null },
  });
  if (rows.length !== unique.length) return undefined;
  return unique.map((id) => toRef(rows.find((r) => r.id === id)!));
}

/** A message now carries these files: they are kept for the full retention period. */
export async function markUsed(ctx: AppContext, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await ctx.prisma.attachment.updateMany({
    where: { id: { in: ids }, usedAt: null },
    data: { usedAt: ctx.now() },
  });
}

/**
 * Removes an upload its owner decided not to send (taken out of the message box). A file that a
 * message already carries can't be deleted this way.
 */
export async function discardAttachment(ctx: AttachmentServices, userId: string, id: string): Promise<void> {
  const a = await ctx.prisma.attachment.findFirst({ where: { id, userId, usedAt: null } });
  if (!a) return; // gone already, or in use: nothing to do
  await ctx.storage?.destroy(a.publicId, storedAs(a.mime)).catch(() => undefined);
  await ctx.prisma.attachment.deleteMany({ where: { id: a.id, usedAt: null } });
}

/** A short-lived link to the file, for its owner (or the owner's PC). */
export async function fileUrl(ctx: AttachmentServices, userId: string, id: string): Promise<string> {
  const storage = storageOf(ctx);
  const a = await ctx.prisma.attachment.findFirst({ where: { id, userId, readyAt: { not: null } } });
  if (!a) throw new AttachmentError('not_found', 'Not found', 404);
  if (a.removedAt)
    throw new AttachmentError(
      'removed',
      `Files are kept for ${ATTACHMENT_RETENTION_DAYS} days. This one was removed; only its preview is left.`,
      410,
    );
  return storage.downloadUrl(
    a.publicId,
    a.mime,
    storedAs(a.mime),
    new Date(ctx.now().getTime() + 5 * 60_000),
  );
}

/** Deletes files older than the retention period from storage (their previews stay). */
export async function removeExpiredAttachments(ctx: AttachmentServices): Promise<number> {
  if (!ctx.storage) return 0;
  const now = ctx.now().getTime();
  const expired = await ctx.prisma.attachment.findMany({
    where: {
      removedAt: null,
      readyAt: { not: null },
      createdAt: { lt: new Date(now - ATTACHMENT_RETENTION_DAYS * 86_400_000) },
    },
    take: 100,
  });
  let removed = 0;
  for (const a of expired) {
    try {
      await ctx.storage.destroy(a.publicId, storedAs(a.mime));
      await ctx.prisma.attachment.update({ where: { id: a.id }, data: { removedAt: ctx.now() } });
      removed++;
    } catch {
      /* storage unreachable: tried again on the next run */
    }
  }
  // Uploads no message ever carried (picked, then removed or never sent), or never finished:
  // gone after an hour, so unused files don't pile up.
  const unused = await ctx.prisma.attachment.findMany({
    where: { usedAt: null, createdAt: { lt: new Date(now - UNUSED_AFTER_MS) } },
    take: 200,
  });
  for (const a of unused) {
    try {
      await ctx.storage.destroy(a.publicId, storedAs(a.mime));
      await ctx.prisma.attachment.deleteMany({ where: { id: a.id, usedAt: null } });
      removed++;
    } catch {
      /* tried again on the next run */
    }
  }
  return removed;
}
