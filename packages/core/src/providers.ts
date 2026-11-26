import type { ProviderId } from '@pocket-agent/protocol';

/** How each coding agent is called: in a sentence ("Claude is done") and as a product. */
const PROVIDERS: Record<ProviderId, { name: string; product: string }> = {
  'claude-code': { name: 'Claude', product: 'Claude Code' },
  codex: { name: 'Codex', product: 'Codex' },
  antigravity: { name: 'Antigravity', product: 'Antigravity CLI' },
  opencode: { name: 'OpenCode', product: 'OpenCode' },
};

/** The agent's name in a sentence: "Claude is done", "Codex needs your OK". Unknown: Claude. */
export function agentName(provider: string | null | undefined): string {
  return (PROVIDERS[provider as ProviderId] ?? PROVIDERS['claude-code']).name;
}

/** The agent as a product: "Claude Code", "Codex". Unknown: Claude Code. */
export function agentProduct(provider: string | null | undefined): string {
  return (PROVIDERS[provider as ProviderId] ?? PROVIDERS['claude-code']).product;
}
