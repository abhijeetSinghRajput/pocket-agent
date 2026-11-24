import {
  BackendToAgent,
  createEvent,
  SUBAGENTS_AGENT_VERSION,
  versionBelow,
  type SubagentDetailResponse,
  type SubagentEvent,
  type SubagentInfo,
} from '@pocket-agent/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session.js';
import { limit, type AppContext } from '../context.js';
import { askPc, pcOnline } from '../devices/ask-pc.js';
import type { Bus } from '../realtime/bus.js';
import { PC_NO_ANSWER } from './devices.js';

const Params = z.object({ id: z.uuid(), toolUseId: z.string().min(1).max(200) });

const ERRORS: Record<string, string> = {
  conversation_not_found: 'This conversation is no longer on your PC.',
  agent_not_found:
    'Your PC has no record of this agent (Claude Code keeps sub-agent transcripts only for its own sessions).',
};

/**
 * The agent map of a chat, read live from its PC: every sub-agent Claude started (and the ones they
 * started), and one agent's prompt, tool calls and transcript. Nothing of it is stored here.
 */
export async function subagentRoutes(app: FastifyInstance, ctx: AppContext & { bus: Bus }): Promise<void> {
  const user = requireUser(ctx);

  app.get(
    '/sessions/:id/agents/:toolUseId',
    { preHandler: user, config: limit(ctx, 60) },
    async (req, reply) => {
      const p = Params.safeParse(req.params);
      if (!p.success) return reply.code(404).send({ error: 'not_found' });
      const fail = (code: number, error: string, message: string) =>
        reply.code(code).send({ error, message });
      const s = await ctx.prisma.agentSession.findFirst({
        where: { id: p.data.id, device: { userId: req.user!.id } },
        include: { device: true },
      });
      if (!s) return reply.code(404).send({ error: 'not_found' });
      if (s.device.revokedAt) return fail(409, 'device_revoked', 'This device was revoked.');
      if (s.provider !== 'claude-code')
        return fail(409, 'not_supported', 'Only Claude Code records its sub-agents.');
      if (versionBelow(s.device.agentVersion, SUBAGENTS_AGENT_VERSION))
        return fail(
          409,
          'agent_outdated',
          `Seeing an agent's work needs Pocket Agent ${SUBAGENTS_AGENT_VERSION} or newer on the PC. Run \`pocket-agent update\` there.`,
        );
      if (!(await pcOnline(ctx, s.device)))
        return fail(
          409,
          'device_offline',
          'Your PC is offline. An agent’s work is read from it: start Pocket Agent there.',
        );

      const requestId = crypto.randomUUID();
      const frame = BackendToAgent.parse(
        createEvent(
          'agents.read',
          { requestId, toolUseId: p.data.toolUseId },
          { deviceId: s.deviceId, sessionId: s.externalSessionId },
        ),
      );
      const answer = await askPc<{
        agents: SubagentInfo[];
        events: SubagentEvent[];
        truncated: boolean;
        error?: string;
      }>(ctx, s.deviceId, requestId, frame);
      if (!answer) return fail(504, 'pc_no_answer', PC_NO_ANSWER);
      if (answer.error)
        return fail(404, answer.error, ERRORS[answer.error] ?? 'Your PC could not read this agent.');
      const agent = answer.agents.find((a) => a.toolUseId === p.data.toolUseId);
      if (!agent) return fail(404, 'agent_not_found', ERRORS['agent_not_found']!);
      const body: SubagentDetailResponse = {
        agent,
        agents: answer.agents,
        events: answer.events.map((e) => ({ ...e, sessionId: s.id })),
        truncated: answer.truncated,
      };
      return body;
    },
  );
}
