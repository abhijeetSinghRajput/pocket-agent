import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { requestJson } from './http.js';

/** Talks to the running agent's local endpoint (127.0.0.1 + per-run token from ingest.json). */
export async function callLocalAgent(
  home: string,
  method: 'GET' | 'POST',
  pathname: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  let endpoint: { port: number; token: string };
  try {
    endpoint = JSON.parse(await readFile(path.join(home, 'ingest.json'), 'utf8')) as typeof endpoint;
  } catch {
    throw new Error('The AgentDock agent is not running. Start it with: agentdock start');
  }
  try {
    return await requestJson(new URL(`http://127.0.0.1:${endpoint.port}${pathname}`), {
      method,
      headers: {
        'x-agentdock-token': endpoint.token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutMs: 30_000,
    });
  } catch {
    throw new Error('The AgentDock agent is not responding. Is `agentdock start` still running?');
  }
}
