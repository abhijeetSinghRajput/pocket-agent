import { useEffect, useRef, useState } from 'react';
import {
  attachmentProblem,
  discardAttachment,
  newId,
  uploadAttachment,
  type DraftFile,
  type PickedFile,
} from '@/features/chat/upload';

/**
 * The files picked for one message: each starts uploading at once and can be removed before
 * sending. `onError` hears about picking more than `maxFiles`. With `keepUploaded` (a chat's
 * draft keeps them), files already uploaded stay on the server when the screen closes.
 */
export function useDraftFiles(
  maxFiles: number,
  onError: (message: string | null) => void,
  { keepUploaded = false }: { keepUploaded?: boolean } = {},
) {
  const [drafts, setDrafts] = useState<DraftFile[]>([]);
  const uploads = useRef(new Map<string, AbortController>());

  // Leaving with files still in the box: stop their uploads, and delete what was stored unless a
  // draft keeps it. The latest drafts are mirrored for the clean-up.
  const latest = useRef(drafts);
  useEffect(() => {
    latest.current = drafts;
  }, [drafts]);
  useEffect(() => {
    const running = uploads.current;
    return () => {
      running.forEach((abort) => abort.abort());
      running.clear();
      if (keepUploaded) return;
      for (const d of latest.current) if (d.ref) void discardAttachment(d.ref.id);
    };
  }, [keepUploaded]);

  function add(files: PickedFile[]) {
    onError(null);
    const room = maxFiles - drafts.length;
    if (files.length > room) onError(`At most ${maxFiles} files per message.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      const key = newId();
      const problem = attachmentProblem(file);
      if (problem) {
        setDrafts((d) => [...d, { key, file, status: 'error', error: problem }]);
        continue;
      }
      setDrafts((d) => [...d, { key, file, status: 'uploading', progress: 0 }]);
      const abort = new AbortController();
      uploads.current.set(key, abort);
      uploadAttachment(file, abort.signal, (progress) =>
        setDrafts((d) => d.map((x) => (x.key === key ? { ...x, progress } : x))),
      )
        .then((ref) => {
          // Removed while the last step was in flight: don't keep the file.
          if (abort.signal.aborted) return void discardAttachment(ref.id);
          setDrafts((d) =>
            d.map((x) =>
              x.key === key ? { ...x, status: 'ready', ref, progress: 1, uploadedAt: Date.now() } : x,
            ),
          );
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
    /** Files uploaded earlier (a saved draft), back in the box. */
    restore: (files: DraftFile[]) => setDrafts((d) => [...files, ...d]),
  };
}
