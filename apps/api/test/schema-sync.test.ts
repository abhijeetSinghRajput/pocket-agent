// Guards against drift between Prisma enums and the shared protocol enums.
import {
  AgentStatus,
  ApprovalStatus,
  CommandStatus,
  DeviceStatus,
  Platform,
  SessionMode,
} from '@agentdock/protocol';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

function prismaEnum(name: string): string[] {
  const m = schema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`));
  if (!m?.[1]) throw new Error(`enum ${name} not found in schema.prisma`);
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'));
}

describe('prisma enums match protocol enums', () => {
  it.each([
    ['AgentStatus', AgentStatus.options],
    ['ApprovalStatus', ApprovalStatus.options],
    ['CommandStatus', CommandStatus.options],
    ['DeviceStatus', DeviceStatus.options],
    ['Platform', Platform.options],
    ['SessionMode', SessionMode.options],
  ] as const)('%s', (name, values) => {
    expect(prismaEnum(name)).toEqual([...values]);
  });
});
