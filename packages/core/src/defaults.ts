import type { ModelOption, TurnMode } from '@pocket-agent/protocol';

/** A new chat runs in Auto mode: safe actions run, risky ones still ask. */
export const NEW_CHAT_MODE: TurnMode = 'auto';

/** The model a new chat starts with, preferred first. */
const PREFERRED_MODELS = [/opus[\s-]*5[.-]5/i, /opus/i];

/**
 * The model a new chat starts with: Opus 5.5 when the PC offers it, else its newest Opus (the
 * list comes newest first), else the PC's own default (`''`). Never a plan-mode variant.
 */
export function newChatModel(models: readonly ModelOption[]): string {
  const usable = models.filter((m) => !/plan/i.test(m.id));
  for (const pattern of PREFERRED_MODELS) {
    const hit = usable.find((m) => pattern.test(m.id) || pattern.test(m.name));
    if (hit) return hit.id;
  }
  return '';
}
