import type { FastifyReply, FastifyRequest } from 'fastify';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params that carry entity ids on admin routes. */
const ID_PARAMS = ['id', 'userId', 'organizationId', 'projectId'];

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * preValidation hook: reject malformed entity ids with 400 instead of letting
 * Postgres raise "invalid input syntax for type uuid" (which surfaced as 500).
 */
export async function validateUuidParams(request: FastifyRequest, reply: FastifyReply) {
  const params = (request.params ?? {}) as Record<string, unknown>;
  for (const key of ID_PARAMS) {
    if (key in params && !isUuid(params[key])) {
      return reply.status(400).send({ error: `Invalid ${key}: must be a UUID` });
    }
  }
}
