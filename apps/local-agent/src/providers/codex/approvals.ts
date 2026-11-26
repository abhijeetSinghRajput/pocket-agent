import type { RemoteDecision } from '../../approvals.js';
import { truncate } from '../../sessions/registry.js';

/**
 * Codex's approval requests (app-server v2) as Pocket Agent permission requests, and the phone's
 * decision back as Codex's answer. Codex asks when it wants to go beyond its sandbox: run a command
 * outside it (or with network), change files outside the project, or get more permissions.
 *
 * Only what the request itself says is shown (command, paths, Codex's reason), and the answer
 * allows exactly that: never more than Codex asked for.
 */

type Json = Record<string, unknown>;

export const CODEX_APPROVAL_METHODS = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
] as const;
export type CodexApprovalMethod = (typeof CODEX_APPROVAL_METHODS)[number];

export const isCodexApproval = (method: string): method is CodexApprovalMethod =>
  (CODEX_APPROVAL_METHODS as readonly string[]).includes(method);

export interface CodexRequest {
  /** Unique on this PC: the chat's id, then Codex's own approval id (else its item id). */
  requestId: string;
  itemId: string;
  /** The tool word the app draws (Bash, Edit, Sandbox). */
  toolName: string;
  /** The request as the app reads it (JSON text, like summarized tool input). */
  input: string;
  /** What "Allow for this session" allows, in plain words. */
  remember: string;
  /** For the chat note when it can't be approved: "run `npm i`". */
  what: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

/**
 * Reads one of Codex's approval requests. `paths` are the files of the item it is about (a file
 * change request names only the item; its files came with the item).
 */
export function readCodexRequest(
  method: CodexApprovalMethod,
  params: Json,
  paths: string[] = [],
): CodexRequest {
  const itemId = String(params['itemId'] ?? '');
  const requestId = truncate(
    `${String(params['threadId'] ?? '')}:${str(params['approvalId']) ?? itemId}`,
    200,
  );
  const reason = str(params['reason']);
  if (method === 'item/commandExecution/requestApproval') {
    const command = str(params['command']) ?? 'a command';
    const host = str((params['networkApprovalContext'] as Json | null | undefined)?.['host']);
    const description = [reason, host ? `Network access to ${host}` : undefined].filter(Boolean).join(' · ');
    return {
      requestId,
      itemId,
      toolName: 'Bash',
      input: JSON.stringify({ command: truncate(command, 2000), ...(description ? { description } : {}) }),
      remember: 'This command, for the rest of this chat',
      what: `run \`${truncate(command, 300)}\``,
    };
  }
  if (method === 'item/fileChange/requestApproval') {
    const first = paths[0];
    const more =
      paths.length > 1 ? `And ${paths.length - 1} more file${paths.length > 2 ? 's' : ''}` : undefined;
    const description = [reason, more].filter(Boolean).join(' · ');
    return {
      requestId,
      itemId,
      toolName: 'Edit',
      input: JSON.stringify({
        ...(first ? { file_path: first } : {}),
        ...(description ? { description } : {}),
      }),
      remember: 'File changes like this, for the rest of this chat',
      what: first ? `change ${first}` : 'change files outside the project',
    };
  }
  // More permissions: network, and/or reading or writing folders outside the sandbox.
  const perms = (params['permissions'] ?? {}) as Json;
  const network = (perms['network'] as Json | null | undefined)?.['enabled'] === true;
  const fs = (perms['fileSystem'] ?? null) as Json | null;
  const write = strings(fs?.['write']).slice(0, 20);
  const read = strings(fs?.['read']).slice(0, 20);
  return {
    requestId,
    itemId,
    toolName: 'Sandbox',
    input: JSON.stringify({
      ...(reason ? { description: reason } : {}),
      ...(network ? { network: 'Internet access' } : {}),
      ...(write.length ? { write } : {}),
      ...(read.length ? { read } : {}),
    }),
    remember: 'These permissions, for the rest of this chat',
    what: 'get more permissions',
  };
}

/**
 * Codex's answer to a request. `null` (no decision: approvals off, timed out, cancelled) declines.
 * A grant of permissions gives back exactly the permissions asked for.
 */
export function codexAnswer(
  method: CodexApprovalMethod,
  params: Json,
  decision: RemoteDecision | null,
): Json {
  const allow = decision?.behavior === 'allow';
  const forSession = allow && decision.remember === true;
  if (method === 'item/permissions/requestApproval') {
    if (!allow) return { permissions: {}, scope: 'turn' };
    const asked = (params['permissions'] ?? {}) as Json;
    const granted: Json = {};
    if (asked['network']) granted['network'] = asked['network'];
    if (asked['fileSystem']) granted['fileSystem'] = asked['fileSystem'];
    return { permissions: granted, scope: forSession ? 'session' : 'turn' };
  }
  return { decision: allow ? (forSession ? 'acceptForSession' : 'accept') : 'decline' };
}
