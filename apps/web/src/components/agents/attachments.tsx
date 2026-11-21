'use client';

import type { AttachmentRef } from '@pocket-agent/protocol';
import { FileText, ImageOff, LoaderCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fileSize, isPdf, openAttachment, thumbUrl } from '@/lib/attachments';
import { cn } from '@/lib/utils';

/** One sent photo or PDF: its preview; tapping opens the original (while it still exists). */
function SentFile({ file, single }: { file: AttachmentRef; single: boolean }) {
  const [broken, setBroken] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdf = isPdf(file);

  async function open() {
    setOpening(true);
    setError(null);
    try {
      await openAttachment(file.id);
    } catch (err) {
      // Usually: the file was removed after 30 days and only this preview is left.
      setError((err as Error).message);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className={cn('min-w-0', single ? 'w-56 max-w-full' : 'w-[calc(50%-0.1875rem)]')}>
      <button
        type="button"
        onClick={() => void open()}
        aria-label={`Open ${file.name}`}
        title={`${file.name} · ${fileSize(file.size)}`}
        data-testid="attachment"
        className="group relative block w-full overflow-hidden rounded-xl bg-black/15 outline-none focus-visible:ring-[3px] focus-visible:ring-white/60"
      >
        {broken ? (
          <span className="grid aspect-[4/3] w-full place-items-center">
            {pdf ? (
              <FileText className="size-7 opacity-80" aria-hidden />
            ) : (
              <ImageOff className="size-7 opacity-80" aria-hidden />
            )}
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a small authenticated preview from our API
          <img
            src={thumbUrl(file.id)}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className={cn(
              'w-full bg-white object-cover transition-transform duration-300 ease-(--ease-out) group-hover:scale-[1.03]',
              single ? 'max-h-64' : 'aspect-square',
            )}
          />
        )}
        {pdf && (
          <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/65 px-2 py-1 text-left text-[11px] font-medium text-white">
            <FileText className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{file.name}</span>
          </span>
        )}
        {opening && (
          <span className="absolute inset-0 grid place-items-center bg-black/40 text-white">
            <LoaderCircle className="size-5 animate-spin" aria-hidden />
          </span>
        )}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-[11px] leading-snug opacity-90">
          {error}
        </p>
      )}
    </div>
  );
}

/** The photos/PDFs of a message, above its text. */
export function SentAttachments({ files }: { files: AttachmentRef[] }) {
  if (!files.length) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5" data-testid="attachments">
      {files.map((f) => (
        <SentFile key={f.id} file={f} single={files.length === 1} />
      ))}
    </div>
  );
}

/** A file picked in the composer, while it uploads and until it is sent. */
export interface DraftFile {
  key: string;
  file: File;
  status: 'uploading' | 'ready' | 'error';
  ref?: AttachmentRef;
  error?: string;
}

function DraftChip({ draft, onRemove }: { draft: DraftFile; onRemove: () => void }) {
  // A local preview of the picked image (never uploaded anywhere but to the message).
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!draft.file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(draft.file);
    const t = setTimeout(() => setPreview(url), 0);
    return () => {
      clearTimeout(t);
      URL.revokeObjectURL(url);
    };
  }, [draft.file]);

  return (
    <li
      className={cn(
        'relative flex h-14 max-w-[13rem] items-center gap-2 rounded-xl bg-muted py-1.5 pr-8 pl-1.5',
        draft.status === 'error' && 'bg-destructive/10 text-destructive',
      )}
      data-testid="draft-file"
      data-status={draft.status}
    >
      <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-background">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <FileText className="size-5 text-muted-foreground" aria-hidden />
        )}
        {draft.status === 'uploading' && (
          <span className="absolute inset-0 grid place-items-center bg-black/45 text-white">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          </span>
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium">{draft.file.name || 'Pasted image'}</span>
        <span className="block truncate text-[11px] opacity-75">
          {draft.status === 'error'
            ? (draft.error ?? 'Could not upload')
            : draft.status === 'uploading'
              ? 'Uploading…'
              : fileSize(draft.file.size)}
        </span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${draft.file.name || 'file'}`}
        className="absolute top-1 right-1 grid size-6 place-items-center rounded-full text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

export function DraftFiles({ drafts, onRemove }: { drafts: DraftFile[]; onRemove: (key: string) => void }) {
  if (!drafts.length) return null;
  return (
    <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attached files" data-enter-new="">
      {drafts.map((d) => (
        <DraftChip key={d.key} draft={d} onRemove={() => onRemove(d.key)} />
      ))}
    </ul>
  );
}
