import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

/**
 * "Allow for this session", from Pocket Agent: Claude Code suggests with each permission request
 * the rules its own "Yes, and don't ask again" would add. Of those, only narrow, session-only
 * additions are kept: allow rules for a tool, extra folders, and auto-accepting edits (its own
 * "allow all edits this session"). Whatever else it suggests (another mode, a deny rule, a rule
 * saved to settings files) is dropped: a decision from the phone never changes settings on disk and
 * never widens Claude Code past what the user saw.
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** A tool rule as Claude Code writes it: `Bash(npm test:*)`, `WebFetch(domain:example.com)`, `Edit`. */
function ruleText(rule: unknown): string | null {
  if (!isObj(rule) || !str(rule['toolName'])) return null;
  const content = str(rule['ruleContent']);
  return content ? `${str(rule['toolName'])}(${content})` : str(rule['toolName']);
}

/** The suggestions this app may apply, all for this session only (none when nothing safe is left). */
export function sessionRules(suggestions: unknown): PermissionUpdate[] {
  if (!Array.isArray(suggestions)) return [];
  const out: PermissionUpdate[] = [];
  for (const s of suggestions) {
    if (!isObj(s)) continue;
    if (s['type'] === 'addRules' && s['behavior'] === 'allow' && Array.isArray(s['rules'])) {
      // Rebuilt from the two fields a rule has: nothing else passes through.
      const rules = s['rules']
        .filter((r): r is Json => ruleText(r) !== null)
        .slice(0, 10)
        .map((r) => ({
          toolName: str(r['toolName']),
          ...(str(r['ruleContent']) ? { ruleContent: str(r['ruleContent']) } : {}),
        }));
      if (rules.length) out.push({ type: 'addRules', behavior: 'allow', rules, destination: 'session' });
    } else if (s['type'] === 'addDirectories' && Array.isArray(s['directories'])) {
      const directories = s['directories']
        .filter((d): d is string => typeof d === 'string' && !!d)
        .slice(0, 5);
      if (directories.length) out.push({ type: 'addDirectories', directories, destination: 'session' });
    } else if (s['type'] === 'setMode' && s['mode'] === 'acceptEdits') {
      out.push({ type: 'setMode', mode: 'acceptEdits', destination: 'session' });
    }
  }
  return out;
}

/** What the rules allow, in a few words for the button that applies them; undefined: none. */
export function describeRules(rules: readonly PermissionUpdate[]): string | undefined {
  const parts = rules.flatMap((r) => {
    if (r.type === 'addRules') return r.rules.map((x) => ruleText(x)).filter((t): t is string => !!t);
    if (r.type === 'addDirectories') return r.directories.map((d) => `files in ${d}`);
    if (r.type === 'setMode') return ['all edits'];
    return [];
  });
  if (!parts.length) return undefined;
  const text = parts.join(', ');
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}
