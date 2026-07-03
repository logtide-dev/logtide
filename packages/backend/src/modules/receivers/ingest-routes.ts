import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { receiversService } from './service.js';
import { createQueue } from '../../queue/connection.js';
import { RECEIVER_EVENTS_QUEUE, type ReceiverEventJobData } from '../../queue/jobs/receiver-event.js';

const paramsSchema = z.object({
  receiverId: z.string().uuid(),
  token: z.string().min(1).max(200),
});

/** Serialized raw payloads above this size are rejected (protects receiver_events). */
const MAX_PAYLOAD_BYTES = 256 * 1024;

const receiverEventsQueue = createQueue<ReceiverEventJobData>(RECEIVER_EVENTS_QUEUE);

/**
 * Public inbound webhook endpoint (#155): POST /api/v1/receivers/:receiverId/:token
 * Token authentication happens here (the URL is the credential; GitHub and
 * Uptime Robot cannot send custom headers). The auth plugin skips this prefix.
 */
export async function receiversIngestRoutes(fastify: FastifyInstance) {
  fastify.post('/:receiverId/:token', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(404).send({ error: 'Receiver not found' });
    }
    const { receiverId, token } = params.data;

    const receiver = await receiversService.getReceiverForIngest(receiverId);
    if (!receiver) {
      return reply.status(404).send({ error: 'Receiver not found' });
    }
    if (!receiversService.tokenMatches(token, receiver.tokenHash)) {
      return reply.status(401).send({ error: 'Invalid receiver token' });
    }
    if (!receiver.enabled) {
      return reply.status(403).send({ error: 'Receiver is disabled' });
    }

    const payload = request.body;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return reply.status(400).send({ error: 'Payload must be a JSON object' });
    }
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
      return reply.status(413).send({ error: 'Payload too large (max 256 KB)' });
    }

    const eventId = await receiversService.recordEvent(
      receiverId,
      payload as Record<string, unknown>
    );
    await receiverEventsQueue.add('process', { eventId }, { maxAttempts: 1 });

    return reply.status(202).send({ eventId });
  });
}
