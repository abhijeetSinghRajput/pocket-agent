import type { ChatItem } from '@pocket-agent/core';
import { CommandResponse, type AttachmentRef, type CommandDto } from '@pocket-agent/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError, apiRequest } from '@/lib/api';
import { failedOffline, holdMessage } from '@/features/chat/waiting';

/** A message on its way: what was sent, where, and how far it got. */
interface Outgoing {
  /** The idempotency key: sending it again can never run it twice. */
  key: string;
  path: string;
  body: Record<string, unknown>;
  text: string;
  files: AttachmentRef[];
  at: string;
  state: 'sending' | 'failed';
  error?: string;
  /** The command the server made of it, once it answered. */
  commandId?: string;
}

/** A message to send: where, what, and its idempotency key. */
export type OutgoingMessage = Pick<Outgoing, 'key' | 'path' | 'body' | 'text' | 'files'>;

/**
 * Messages sent from this chat, shown the moment they are sent (before the server answers) and
 * kept when they could not be sent, to send again. Each leaves once the chat lists the command
 * the server made of it. `send` and `retry` never change (the chat list doesn't redraw for them).
 */
export function useOutbox(on: {
  /** Where its messages go: one that can't go yet waits on this phone for them. */
  chat: { sessionId: string; deviceId: string };
  /** The server took it and passed it on (the command may still fail on the PC). */
  accepted: (command: CommandDto) => void;
  /** It can't go yet (no connection, or the PC is offline): it waits and goes by itself. */
  held: () => void;
  /** The server refused it: it stays, to send again. */
  failed: () => void;
}) {
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const handlers = useRef(on);
  const latest = useRef(outgoing);
  useEffect(() => {
    handlers.current = on;
    latest.current = outgoing;
  });

  const post = useCallback(async (o: Outgoing) => {
    const update = (change: Partial<Outgoing>) =>
      setOutgoing((list) => list.map((x) => (x.key === o.key ? { ...x, ...change } : x)));
    update({ state: 'sending', error: undefined });
    const { chat } = handlers.current;
    const hold = (extra: { key?: string; replaces?: string }) => {
      holdMessage({ ...chat, path: o.path, body: o.body, text: o.text, files: o.files, at: o.at, ...extra });
      setOutgoing((list) => list.filter((x) => x.key !== o.key));
      handlers.current.held();
    };
    try {
      const { command } = await apiRequest(o.path, CommandResponse, { method: 'POST', body: o.body });
      // Nothing reached the PC: it waits for it under a new key (this one is a failed command).
      if (failedOffline(command) && chat.deviceId) return hold({ replaces: command.id });
      update({ commandId: command.id });
      handlers.current.accepted(command);
    } catch (err) {
      // No answer: the same key, so if the server did get it, it can never run twice.
      if (err instanceof ApiClientError && err.status === 0 && chat.deviceId) return hold({ key: o.key });
      update({ state: 'failed', error: (err as Error).message });
      handlers.current.failed();
    }
  }, []);

  /** Sends a message: it shows in the chat at once. */
  const send = useCallback(
    (message: OutgoingMessage) => {
      const o: Outgoing = { ...message, at: new Date().toISOString(), state: 'sending' };
      setOutgoing((list) => [...list, o]);
      void post(o);
    },
    [post],
  );

  /** Sends again a message that could not be sent (same key: it can never run twice). */
  const retry = useCallback(
    (key: string) => {
      const o = latest.current.find((x) => x.key === key);
      if (o && o.state === 'failed') void post(o);
    },
    [post],
  );

  /** Drops a message that could not be sent (it is being edited instead). */
  const discard = useCallback((key: string) => {
    setOutgoing((list) => list.filter((x) => !(x.key === key && x.state === 'failed')));
  }, []);

  /**
   * The messages still on their way, as chat items. `known` is the commands the chat lists: a
   * message they include has arrived and is drawn from them instead.
   */
  const items = (known: readonly CommandDto[]): Extract<ChatItem, { kind: 'user' }>[] => {
    const ids = new Set(known.map((c) => c.id));
    return outgoing
      .filter((o) => !o.commandId || !ids.has(o.commandId))
      .map((o) => ({
        kind: 'user',
        key: `out-${o.key}`,
        at: o.at,
        text: o.text,
        ...(o.files.length ? { attachments: o.files } : {}),
        local: o.state,
      }));
  };

  return { outgoing, send, retry, discard, items };
}
