/**
 * Public Digest Routes (#154)
 *
 * One-click unsubscribe consumed by the link in digest email footers. No
 * authentication: the 32-byte random unsubscribe token is the credential
 * (unique index on digest_recipients.unsubscribe_token, not enumerable).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { digestsService } from './service.js';

const unsubscribeSchema = z.object({
  token: z.string().min(1).max(200),
});

/**
 * Mask an email for the unsubscribe confirmation page: g***@example.com
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

export async function digestsPublicRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/v1/digests/unsubscribe
   * Marks the recipient behind the token as unsubscribed. Idempotent.
   */
  fastify.post('/unsubscribe', async (request, reply) => {
    const parsed = unsubscribeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid unsubscribe request' });
    }

    const result = await digestsService.unsubscribeByToken(parsed.data.token);
    if (!result) {
      return reply.status(404).send({ error: 'Invalid or expired unsubscribe link' });
    }

    return reply.send({ success: true, email: maskEmail(result.email) });
  });
}
