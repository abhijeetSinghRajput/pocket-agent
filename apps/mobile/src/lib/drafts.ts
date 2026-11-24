import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AttachmentRef } from '@pocket-agent/protocol';
import { useSyncExternalStore } from 'react';

/**
 * Unsent messages, one per chat, kept on this phone: the text and the files already uploaded for
 * it. Leaving a chat (or the app) keeps them; the chat list shows a chat's draft as its preview.
 */

/** A file uploaded for a draft: what the server stored, and the picked file (for its preview). */
export interface DraftAttachment {
  ref: AttachmentRef;
  file: { uri: string; name: string; mime: string; size: number };
  /** The server drops uploads nobody sent after an hour: older ones are left out. */
  uploadedAt: number;
}
export interface Draft {
  text: string;
  files: DraftAttachment[];
}

const KEY = 'pocket-agent:chat-draft:';
/** The text-only drafts of earlier versions (moved over on first read). */
const OLD_KEY = 'pocket-agent:draft:';
/** Uploads older than this are left out of a draft (the server removes unsent ones after 1 h). */
const FILES_KEEP_MS = 55 * 60_000;

const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();
let snapshot = new Map(drafts);
let loaded: Promise<void> | null = null;
/** Whether the saved drafts have been read (a chat must not overwrite one before that). */
let ready = false;

const emit = () => {
  snapshot = new Map(drafts);
  listeners.forEach((l) => l());
};

const isEmpty = (d: Draft) => !d.text.trim() && !d.files.length;

/** Reads every saved draft once (and moves text-only ones from the old key). */
function load(): Promise<void> {
  loaded ??= (async () => {
    const keys = (await AsyncStorage.getAllKeys().catch(() => [] as readonly string[])).filter(
      (k) => k.startsWith(KEY) || k.startsWith(OLD_KEY),
    );
    const pairs = await AsyncStorage.multiGet(keys).catch(() => [] as readonly [string, string | null][]);
    const now = Date.now();
    for (const [k, raw] of pairs) {
      if (!raw) continue;
      if (k.startsWith(KEY)) {
        try {
          const d = JSON.parse(raw) as Draft;
          const files = (d.files ?? []).filter((f) => now - f.uploadedAt < FILES_KEEP_MS);
          if (!drafts.has(k.slice(KEY.length)) && (d.text || files.length))
            drafts.set(k.slice(KEY.length), { ...d, files });
        } catch {
          /* unreadable: dropped */
        }
      } else {
        const id = k.slice(OLD_KEY.length);
        if (!drafts.has(id)) {
          drafts.set(id, { text: raw, files: [] });
          void AsyncStorage.setItem(KEY + id, JSON.stringify(drafts.get(id))).catch(() => undefined);
        }
        void AsyncStorage.removeItem(k).catch(() => undefined);
      }
    }
    ready = true;
    emit();
  })();
  return loaded;
}

/** A chat's draft as saved now. */
export const getDraft = (sessionId: string): Draft => drafts.get(sessionId) ?? { text: '', files: [] };

/** Saves (or, empty, forgets) a chat's draft. */
export function saveDraft(sessionId: string, draft: Draft): void {
  if (isEmpty(draft)) {
    if (!drafts.delete(sessionId)) return;
    void AsyncStorage.removeItem(KEY + sessionId).catch(() => undefined);
  } else {
    drafts.set(sessionId, draft);
    void AsyncStorage.setItem(KEY + sessionId, JSON.stringify(draft)).catch(() => undefined);
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => {
    listeners.delete(listener);
  };
}

/** Every chat's draft (live): for the chat list. */
export function useDrafts(): ReadonlyMap<string, Draft> {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** One chat's draft (live), and whether the saved drafts have been read yet. */
export function useDraft(sessionId: string): { draft: Draft | undefined; ready: boolean } {
  const all = useDrafts();
  return { draft: all.get(sessionId), ready: useSyncExternalStore(subscribe, () => ready) };
}
