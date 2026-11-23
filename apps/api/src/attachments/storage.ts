import { createHash } from 'node:crypto';

/** Where attachment files live. Injectable so tests never talk to a real storage service. */
/** Photos and PDFs are stored as images (they get previews); everything else as plain files. */
export type StoredAs = 'image' | 'raw';

export interface AttachmentStorage {
  /** A signed direct upload for `publicId` (the browser or the PC sends the file straight to storage). */
  signUpload(publicId: string, as: StoredAs): { uploadUrl: string; fields: Record<string, string> };
  /** Did storage really sign this upload result? */
  verifyUpload(publicId: string, version: number, signature: string): boolean;
  /** The stored file's real size and format, or null if it is not there. */
  info(publicId: string, as: StoredAs): Promise<{ bytes: number; format: string } | null>;
  /** A small JPEG preview (first page for a PDF), or null if none could be made. */
  thumbnail(publicId: string, mime: string): Promise<Buffer | null>;
  /** A short-lived link to the original file. */
  downloadUrl(publicId: string, mime: string, as: StoredAs, expiresAt: Date): string;
  destroy(publicId: string, as: StoredAs): Promise<void>;
}

const FORMAT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};
export const ALLOWED_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf'];
/** A sharp phone-size preview (a single photo fills ~670 px on a 3x screen) still fits easily. */
const THUMB_MAX_BYTES = 220_000;

/**
 * Cloudinary, over its REST API (no SDK). Files are uploaded as `authenticated`: they can only be
 * fetched with a URL signed by our secret, which only this API creates, after checking who asks.
 */
export function cloudinaryStorage(url: string, now: () => number = Date.now): AttachmentStorage {
  const m = /^cloudinary:\/\/(\d+):([^@]+)@(.+)$/.exec(url);
  if (!m) throw new Error('CLOUDINARY_URL must look like cloudinary://<key>:<secret>@<cloud>');
  const [, key, secret, cloud] = m as unknown as [string, string, string, string];
  const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');
  const sign = (params: Record<string, string | number>) =>
    sha1(
      Object.keys(params)
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&') + secret,
    );
  const strings = (params: Record<string, string | number>) =>
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const api = `https://api.cloudinary.com/v1_1/${cloud}`;
  const seconds = () => Math.floor(now() / 1000);

  return {
    signUpload(publicId, as) {
      const params = {
        // Images and PDFs must really be one of those; other files are stored as they are.
        ...(as === 'image' ? { allowed_formats: ALLOWED_FORMATS.join(',') } : {}),
        public_id: publicId,
        timestamp: seconds(),
        type: 'authenticated',
      };
      return {
        uploadUrl: `${api}/${as}/upload`,
        fields: { ...strings(params), api_key: key, signature: sign(params) },
      };
    },

    verifyUpload(publicId, version, signature) {
      return signature === sha1(`public_id=${publicId}&version=${version}${secret}`);
    },

    async info(publicId, as) {
      const res = await fetch(`${api}/resources/${as}/authenticated/${publicId}`, {
        headers: { authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { bytes?: unknown; format?: unknown };
      // Plain files have no format of their own.
      return typeof j.bytes === 'number'
        ? { bytes: j.bytes, format: typeof j.format === 'string' ? j.format : '' }
        : null;
    },

    async thumbnail(publicId, mime) {
      const transform = `${mime === 'application/pdf' ? 'pg_1/' : ''}c_limit,h_960,w_960/f_jpg,q_auto:good`;
      const signature = createHash('sha1')
        .update(`${transform}/${publicId}${secret}`)
        .digest('base64url')
        .slice(0, 8);
      const res = await fetch(
        `https://res.cloudinary.com/${cloud}/image/authenticated/s--${signature}--/${transform}/${publicId}`,
        { signal: AbortSignal.timeout(20_000) },
      );
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length && buf.length <= THUMB_MAX_BYTES ? buf : null;
    },

    downloadUrl(publicId, mime, as, expiresAt) {
      const params = {
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        ...(as === 'image' ? { format: FORMAT[mime] ?? 'jpg' } : {}),
        public_id: publicId,
        timestamp: seconds(),
        type: 'authenticated',
      };
      const qs = new URLSearchParams({ ...strings(params), api_key: key, signature: sign(params) });
      return `${api}/${as}/download?${qs.toString()}`;
    },

    async destroy(publicId, as) {
      const params = { invalidate: 'true', public_id: publicId, timestamp: seconds(), type: 'authenticated' };
      const res = await fetch(`${api}/${as}/destroy`, {
        method: 'POST',
        body: new URLSearchParams({ ...strings(params), api_key: key, signature: sign(params) }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`storage delete failed: HTTP ${res.status}`);
    },
  };
}
