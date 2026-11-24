import type { ChatItem } from '@pocket-agent/core';
import { CommandResponse, type AttachmentRef, type CommandDto } from '@pocket-agent/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api';

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
  /** The server took it (the command may still have failed, e.g. the PC is offline). */
  accepted: (command: CommandDto) => void;
  /** It could not be sent (no connection, the server refused it). */
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
    try {
      const { command } = await apiRequest(o.path, CommandResponse, { method: 'POST', body: o.body });
      update({ commandId: command.id });
      handlers.current.accepted(command);
    } catch (err) {
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
