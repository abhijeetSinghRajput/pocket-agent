'use client';

import type { AttachmentRef } from '@pocket-agent/protocol';
import { FileText, ImageOff, LoaderCircle, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';
import { useBackToClose } from '@/components/ui/dialog';
import { fileExtension, fileSize, isPdf, isPreviewable, openAttachment, thumbUrl } from '@/lib/attachments';
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

  if (!isPreviewable(file.mime)) {
    // Not a picture: the file as a card (type, name, size); tapping opens it.
    const ext = fileExtension(file.name) || 'file';
    return (
      <div className="w-full min-w-0">
        <button
          type="button"
          onClick={() => void open()}
          aria-label={`Open ${file.name}`}
          data-testid="attachment"
          className="flex w-full min-w-0 items-center gap-2.5 rounded-xl bg-black/15 p-2 pr-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-white/60"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-black/20 font-mono text-[10.5px] font-bold uppercase">
            {opening ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : ext.slice(0, 4)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium">{file.name}</span>
            <span className="block text-[11px] opacity-80">{fileSize(file.size)}</span>
          </span>
        </button>
        {error && (
          <p role="alert" className="mt-1 text-[11px] leading-snug opacity-90">
            {error}
          </p>
        )}
      </div>
    );
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
  const [viewing, setViewing] = useState(false);
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
          <button
            type="button"
            onClick={() => setViewing(true)}
            aria-label={`View ${draft.file.name || 'image'}`}
            className="size-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img src={preview} alt="" className="size-full object-cover" />
          </button>
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
      {preview && (
        <ImageViewer
          src={preview}
          name={draft.file.name || 'Pasted image'}
          open={viewing}
          onOpenChange={setViewing}
        />
      )}
    </li>
  );
}

/** A picked image, full screen. Tap outside, the X or the back button closes it. */
function ImageViewer({
  src,
  name,
  open,
  onOpenChange,
}: {
  src: string;
  name: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  useBackToClose(open, () => onOpenChange(false));
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          data-testid="image-viewer"
          onClick={() => onOpenChange(false)}
          className="fixed inset-0 z-50 grid place-items-center p-4 pt-[calc(3.5rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[state=open]:fade-in-0"
        >
          <Dialog.Title className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-16 left-4 truncate text-sm font-medium text-white">
            {name}
          </Dialog.Title>
          <Dialog.Description className="sr-only">Preview of the picked image.</Dialog.Description>
          <Dialog.Close
            aria-label="Close"
            className="absolute top-[calc(0.5rem+env(safe-area-inset-top))] right-2 grid size-11 place-items-center rounded-full text-white outline-none hover:bg-white/10 focus-visible:ring-[3px] focus-visible:ring-white/60"
          >
            <X className="size-5" aria-hidden />
          </Dialog.Close>
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
          <img src={src} alt={name} className="max-h-full max-w-full rounded-lg object-contain" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
