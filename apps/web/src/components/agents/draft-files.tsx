'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DraftFile } from '@/components/agents/attachments';
import { attachmentProblem, discardAttachment, uploadAttachment } from '@/lib/attachments';
import { cn } from '@/lib/utils';

/**
 * The files picked for one message: each starts uploading at once and can be removed before
 * sending. `onError` hears about picking more than `maxFiles`. With `keepUploaded` (a chat's
 * composer), files already uploaded stay on the server when the screen closes; otherwise leaving
 * deletes them (as in the app's New chat).
 */
export function useDraftFiles(
  maxFiles: number,
  onError: (message: string | null) => void,
  { keepUploaded = false }: { keepUploaded?: boolean } = {},
) {
  const [drafts, setDrafts] = useState<DraftFile[]>([]);
  const uploads = useRef(new Map<string, AbortController>());

  // Leaving with files still in the box: stop their uploads, and delete what was stored unless
  // they are kept. The latest drafts are mirrored for the clean-up.
  const latest = useRef(drafts);
  useEffect(() => {
    latest.current = drafts;
  }, [drafts]);
  useEffect(() => {
    const running = uploads.current;
    return () => {
      if (keepUploaded) return;
      running.forEach((abort) => abort.abort());
      running.clear();
      for (const d of latest.current) if (d.ref) void discardAttachment(d.ref.id);
    };
  }, [keepUploaded]);

  function add(list: Iterable<File>) {
    onError(null);
    const room = maxFiles - drafts.length;
    const files = [...list];
    if (files.length > room) onError(`At most ${maxFiles} files per message.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      const key = crypto.randomUUID();
      const problem = attachmentProblem(file);
      if (problem) {
        setDrafts((d) => [...d, { key, file, status: 'error', error: problem }]);
        continue;
      }
      setDrafts((d) => [...d, { key, file, status: 'uploading' }]);
      const abort = new AbortController();
      uploads.current.set(key, abort);
      uploadAttachment(file, abort.signal)
        .then((ref) => {
          // Removed while the last step was in flight: don't keep the file.
          if (abort.signal.aborted) return void discardAttachment(ref.id);
          setDrafts((d) => d.map((x) => (x.key === key ? { ...x, status: 'ready', ref } : x)));
        })
        .catch((err: Error) => {
          if (abort.signal.aborted) return;
          setDrafts((d) => d.map((x) => (x.key === key ? { ...x, status: 'error', error: err.message } : x)));
        })
        .finally(() => uploads.current.delete(key));
    }
  }

  /** Removed before sending: stop the upload, and delete what was already stored. */
  function remove(key: string) {
    uploads.current.get(key)?.abort();
    uploads.current.delete(key);
    const ref = drafts.find((d) => d.key === key)?.ref;
    if (ref) void discardAttachment(ref.id);
    setDrafts((d) => d.filter((x) => x.key !== key));
  }

  const ready = drafts.filter((d) => d.status === 'ready' && d.ref);
  return {
    drafts,
    ready,
    /** The ids to send with the message. */
    ids: ready.map((d) => d.ref!.id),
    uploading: drafts.some((d) => d.status === 'uploading'),
    room: maxFiles - drafts.length,
    add,
    remove,
    /** Sent: the box is empty again (the files now belong to the message). */
    clear: () => setDrafts([]),
  };
}

/**
 * Files dragged anywhere over the window are handed to `onFiles` (native drag and drop) while
 * `enabled`. Returns whether files are being dragged over it now (show `<DropOverlay />`).
 */
export function useFileDrop(enabled: boolean, onFiles: (files: FileList) => void) {
  const [dragging, setDragging] = useState(false);
  const cb = useRef(onFiles);
  useEffect(() => {
    cb.current = onFiles;
  });
  useEffect(() => {
    if (!enabled) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) cb.current(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [enabled]);
  return enabled && dragging;
}

/** Shown while files are dragged over the window: drop them anywhere to attach them. */
export function DropOverlay() {
  const corner = 'absolute size-14 border-primary';
  // In <body>: a parent with a backdrop filter would otherwise confine a fixed overlay to itself.
  return createPortal(
    <div
      aria-hidden
      data-testid="drop-overlay"
      className="content-in pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm"
    >
      <span className={cn(corner, 'top-6 left-6 rounded-tl-3xl border-t-[5px] border-l-[5px]')} />
      <span className={cn(corner, 'top-6 right-6 rounded-tr-3xl border-t-[5px] border-r-[5px]')} />
      <span className={cn(corner, 'bottom-6 left-6 rounded-bl-3xl border-b-[5px] border-l-[5px]')} />
      <span className={cn(corner, 'right-6 bottom-6 rounded-br-3xl border-r-[5px] border-b-[5px]')} />
      <div className="text-center">
        <p className="text-3xl font-semibold tracking-tight">Drop files anywhere</p>
        <p className="mt-2 text-sm text-muted-foreground">Photos, PDFs, documents, code… up to 10 MB each</p>
      </div>
    </div>,
    document.body,
  );
}
