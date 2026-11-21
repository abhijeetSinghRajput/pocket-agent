import {
  AttachmentResponse,
  CommandResponse,
  createEvent,
  deviceAuthHeader,
  SignAttachmentResponse,
} from '@pocket-agent/protocol';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeExpiredAttachments } from '../src/attachments/service.js';
import type { AttachmentStorage } from '../src/attachments/storage.js';
import {
  browser,
  connectAgent,
  createUserWithSession,
  deleteUser,
  pairDevice,
  sessionStarted,
  startTestApp,
  type TestApp,
} from './helpers.js';

/** In-memory storage: remembers what was "uploaded" and what was destroyed. */
function fakeStorage() {
  const stored = new Map<string, { bytes: number; format: string }>();
  const destroyed: string[] = [];
  const storage: AttachmentStorage = {
    signUpload: (publicId) => ({ uploadUrl: 'https://storage.test/upload', fields: { public_id: publicId } }),
    verifyUpload: (_id, _version, signature) => signature === 'a'.repeat(40),
    info: async (publicId) => stored.get(publicId) ?? null,
    thumbnail: async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    downloadUrl: (publicId) => `https://storage.test/download/${publicId}`,
    destroy: async (publicId) => {
      destroyed.push(publicId);
      stored.delete(publicId);
    },
  };
  return { storage, stored, destroyed };
}

let t: TestApp;
let off: TestApp;
const fake = fakeStorage();
const users: string[] = [];
beforeAll(async () => {
  t = await startTestApp({ storage: fake.storage });
  off = await startTestApp();
});
afterAll(async () => {
  for (const id of users) await deleteUser(t.ctx, id);
  await t.close();
  await off.close();
});

const GOOD = { version: 1, signature: 'a'.repeat(40) };
const post = (app: TestApp, url: string, cookie: string, payload: object) =>
  app.app.inject({ method: 'POST', url, headers: browser(cookie), payload });

async function user() {
  const u = await createUserWithSession(t.ctx);
  users.push(u.user.id);
  return u;
}

/** Signs, "uploads" and completes one attachment for the user. */
async function upload(cookie: string, input = { name: 'shot.png', mime: 'image/png', size: 1234 }) {
  const signed = SignAttachmentResponse.parse((await post(t, '/attachments/sign', cookie, input)).json());
  const publicId = signed.fields['public_id']!;
  fake.stored.set(publicId, { bytes: input.size, format: 'png' });
  const done = await post(t, `/attachments/${signed.attachment.id}/complete`, cookie, GOOD);
  return { signed, publicId, done };
}

describe('attachments', () => {
  it('signs a direct upload, verifies it, and serves the preview and a file link to the owner only', async () => {
    const a = await user();
    const b = await user();
    const { signed, publicId, done } = await upload(a.cookie);
    expect(publicId).toMatch(/^pocket-agent\/[0-9a-f-]{36}$/); // random: no user or file name in it
    expect(done.statusCode).toBe(200);
    const id = AttachmentResponse.parse(done.json()).attachment.id;
    expect(id).toBe(signed.attachment.id);

    const thumb = await t.app.inject({
      method: 'GET',
      url: `/attachments/${id}/thumb`,
      headers: { cookie: a.cookie },
    });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/jpeg');
    const file = await t.app.inject({
      method: 'GET',
      url: `/attachments/${id}/file`,
      headers: { cookie: a.cookie },
    });
    expect(file.statusCode).toBe(302);
    expect(file.headers['location']).toBe(`https://storage.test/download/${publicId}`);
    expect(file.headers['cache-control']).toBe('no-store');

    // Someone else, or nobody: nothing.
    for (const cookie of [b.cookie, '']) {
      for (const what of ['thumb', 'file']) {
        const res = await t.app.inject({
          method: 'GET',
          url: `/attachments/${id}/${what}`,
          headers: { cookie },
        });
        expect([401, 404]).toContain(res.statusCode);
      }
    }
    expect((await post(t, `/attachments/${id}/complete`, b.cookie, GOOD)).statusCode).toBe(404);
  });

  it('rejects unsupported types, oversize files and unverified uploads', async () => {
    const a = await user();
    for (const bad of [
      { name: 'run.exe', mime: 'application/x-msdownload', size: 10 },
      { name: 'big.png', mime: 'image/png', size: 11 * 1024 * 1024 },
      { name: '', mime: 'image/png', size: 10 },
    ]) {
      expect((await post(t, '/attachments/sign', a.cookie, bad)).statusCode).toBe(400);
    }
    const signed = SignAttachmentResponse.parse(
      (await post(t, '/attachments/sign', a.cookie, { name: 'a.png', mime: 'image/png', size: 10 })).json(),
    );
    // A made-up storage answer.
    const forged = await post(t, `/attachments/${signed.attachment.id}/complete`, a.cookie, {
      version: 1,
      signature: 'b'.repeat(40),
    });
    expect(forged.json().error).toBe('upload_not_verified');
    // Storage says the real file is bigger than allowed: it is deleted.
    fake.stored.set(signed.fields['public_id']!, { bytes: 50 * 1024 * 1024, format: 'png' });
    const big = await post(t, `/attachments/${signed.attachment.id}/complete`, a.cookie, GOOD);
    expect(big.json().error).toBe('too_large');
    expect(fake.destroyed).toContain(signed.fields['public_id']);
  });

  it('travels with an instruction to the PC, which may fetch the file; other users’ files are refused', async () => {
    const a = await user();
    const b = await user();
    const d = await pairDevice(t, a.cookie);
    const agent = await connectAgent(t, d);
    const ext = `sess-${randomUUID()}`;
    await agent.send(
      sessionStarted(ext, {
        mode: 'managed',
        capabilities: {
          monitor: true,
          remoteApproval: true,
          instructAnytime: true,
          instructBetweenTurns: true,
          interrupt: true,
        },
      }),
    );
    const session = await t.ctx.prisma.agentSession.findUniqueOrThrow({
      where: { deviceId_externalSessionId: { deviceId: d.deviceId, externalSessionId: ext } },
    });
    const mine = await upload(a.cookie);
    const theirs = await upload(b.cookie);
    const send = (attachmentIds: string[]) =>
      post(t, `/sessions/${session.id}/instructions`, a.cookie, {
        text: 'What is in this picture?',
        attachmentIds,
        idempotencyKey: randomUUID(),
      });

    expect((await send([theirs.signed.attachment.id])).json().error).toBe('attachment_not_found');

    const res = await send([mine.signed.attachment.id]);
    expect(res.statusCode).toBe(201);
    expect(CommandResponse.parse(res.json()).command.attachments).toMatchObject([
      { id: mine.signed.attachment.id, name: 'shot.png', mime: 'image/png' },
    ]);
    const frame = await agent.next((m) => m['eventType'] === 'command.execute');
    expect((frame['payload'] as { attachments: unknown[] }).attachments).toMatchObject([
      { id: mine.signed.attachment.id, name: 'shot.png' },
    ]);

    // The PC downloads with its device credentials: its own user's file only.
    const pc = { authorization: deviceAuthHeader(d.deviceId, d.deviceSecret) };
    const ok = await t.app.inject({
      method: 'GET',
      url: `/agent/attachments/${mine.signed.attachment.id}/file`,
      headers: pc,
    });
    expect(ok.statusCode).toBe(302);
    const no = await t.app.inject({
      method: 'GET',
      url: `/agent/attachments/${theirs.signed.attachment.id}/file`,
      headers: pc,
    });
    expect(no.statusCode).toBe(404);
    expect(
      (await t.app.inject({ method: 'GET', url: `/agent/attachments/${mine.signed.attachment.id}/file` }))
        .statusCode,
    ).toBe(401);

    // A file attached on the PC: the PC uploads it and names it in the message; a foreign id is dropped.
    const signed = SignAttachmentResponse.parse(
      (
        await t.app.inject({
          method: 'POST',
          url: '/agent/attachments/sign',
          headers: pc,
          payload: { name: 'pasted.png', mime: 'image/png', size: 99 },
        })
      ).json(),
    );
    fake.stored.set(signed.fields['public_id']!, { bytes: 99, format: 'png' });
    await t.app.inject({
      method: 'POST',
      url: `/agent/attachments/${signed.attachment.id}/complete`,
      headers: pc,
      payload: GOOD,
    });
    await agent.send(
      createEvent(
        'agent.output',
        {
          role: 'user',
          text: '',
          attachments: [signed.attachment, { ...theirs.signed.attachment }],
        },
        { sessionId: ext },
      ),
    );
    const stored = await t.ctx.prisma.agentEvent.findFirstOrThrow({
      where: { sessionId: session.id, eventType: 'agent.output' },
      orderBy: { createdAt: 'desc' },
    });
    expect((stored.payload as { attachments: Array<{ id: string }> }).attachments.map((x) => x.id)).toEqual([
      signed.attachment.id,
    ]);
    agent.ws.close();
  });

  it('removes files from storage after 30 days; the preview stays, opening says why it can’t', async () => {
    const a = await user();
    const { signed, publicId } = await upload(a.cookie);
    const id = signed.attachment.id;
    await t.ctx.prisma.attachment.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - 31 * 86_400_000), usedAt: new Date() },
    });
    expect(await removeExpiredAttachments({ ...t.ctx, storage: fake.storage })).toBeGreaterThanOrEqual(1);
    expect(fake.destroyed).toContain(publicId);

    const thumb = await t.app.inject({
      method: 'GET',
      url: `/attachments/${id}/thumb`,
      headers: { cookie: a.cookie },
    });
    expect(thumb.statusCode).toBe(200); // still previewed
    const file = await t.app.inject({
      method: 'GET',
      url: `/attachments/${id}/file`,
      headers: { cookie: a.cookie },
    });
    expect(file.statusCode).toBe(410);
    expect(file.json().error).toBe('removed');
  });

  it('deletes an upload taken out of the message box, and sweeps uploads nobody sent', async () => {
    const a = await user();
    const b = await user();
    // Picked, then removed before sending: gone at once (only by its owner).
    const cut = await upload(a.cookie);
    const del = (cookie: string, id: string) =>
      t.app.inject({ method: 'DELETE', url: `/attachments/${id}`, headers: browser(cookie) });
    expect((await del(b.cookie, cut.signed.attachment.id)).statusCode).toBe(204); // someone else: no effect
    expect(await t.ctx.prisma.attachment.count({ where: { id: cut.signed.attachment.id } })).toBe(1);
    expect((await del(a.cookie, cut.signed.attachment.id)).statusCode).toBe(204);
    expect(await t.ctx.prisma.attachment.count({ where: { id: cut.signed.attachment.id } })).toBe(0);
    expect(fake.destroyed).toContain(cut.publicId);

    // Left in the box and never sent: swept after an hour. A sent file is kept.
    const left = await upload(a.cookie);
    const sent = await upload(a.cookie);
    await t.ctx.prisma.attachment.update({
      where: { id: sent.signed.attachment.id },
      data: { usedAt: new Date() },
    });
    await t.ctx.prisma.attachment.updateMany({
      where: { id: { in: [left.signed.attachment.id, sent.signed.attachment.id] } },
      data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });
    await removeExpiredAttachments({ ...t.ctx, storage: fake.storage });
    expect(await t.ctx.prisma.attachment.count({ where: { id: left.signed.attachment.id } })).toBe(0);
    expect(fake.destroyed).toContain(left.publicId);
    expect(await t.ctx.prisma.attachment.count({ where: { id: sent.signed.attachment.id } })).toBe(1);
    // A file a message carries can't be deleted from the box any more.
    await del(a.cookie, sent.signed.attachment.id);
    expect(await t.ctx.prisma.attachment.count({ where: { id: sent.signed.attachment.id } })).toBe(1);
  });

  it('is off without storage configured', async () => {
    const u = await createUserWithSession(off.ctx);
    users.push(u.user.id);
    const res = await post(off, '/attachments/sign', u.cookie, {
      name: 'a.png',
      mime: 'image/png',
      size: 10,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('attachments_disabled');
  });
});
