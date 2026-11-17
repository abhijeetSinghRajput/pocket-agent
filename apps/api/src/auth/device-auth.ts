import { parseDeviceAuthHeader } from '@agentdock/protocol';
import { timingSafeEqual } from 'node:crypto';
import type { AppContext } from '../context.js';
import type { Device } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { sha256 } from '../lib/crypto.js';

export type DeviceAuthResult =
  { ok: true; device: Device } | { ok: false; reason: 'missing' | 'invalid' | 'revoked' };

function hexEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Verifies an `AgentDock-Device <id>:<secret>` header. A match on the pending secret completes
 * a rotation: the pending secret becomes current and the old one stops working.
 * Revoked devices never authenticate.
 */
export async function authenticateDevice(
  ctx: AppContext,
  header: string | undefined,
): Promise<DeviceAuthResult> {
  const creds = parseDeviceAuthHeader(header);
  if (!creds) return { ok: false, reason: header ? 'invalid' : 'missing' };

  const device = await ctx.prisma.device.findUnique({ where: { id: creds.deviceId } });
  const presented = sha256(creds.secret);
  // Compare against a dummy when the device doesn't exist so timing is uniform.
  const current = device?.secretHash ?? sha256('');
  const matchesCurrent = hexEqual(presented, current);
  const matchesPending = !!device?.pendingSecretHash && hexEqual(presented, device.pendingSecretHash);

  if (!device || (!matchesCurrent && !matchesPending)) return { ok: false, reason: 'invalid' };
  if (device.revokedAt) return { ok: false, reason: 'revoked' };

  if (matchesPending) {
    const promoted = await ctx.prisma.device.update({
      where: { id: device.id },
      data: { secretHash: device.pendingSecretHash!, pendingSecretHash: null },
    });
    await audit(ctx.prisma, {
      userId: device.userId,
      actorType: 'device',
      actorId: device.id,
      action: 'device.secret_rotated',
      targetType: 'device',
      targetId: device.id,
    });
    return { ok: true, device: promoted };
  }
  return { ok: true, device };
}
