import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { billingPlanChangeSchema, BILLING_SESSION_ID_RE } from '@logtide/shared';
import { OrganizationsService } from '../organizations/service.js';
import { forwardToBilling } from './proxy.js';

const organizationsService = new OrganizationsService();

const orgParamsSchema = z.object({ id: z.string().uuid('Invalid organization ID format') });
const sessionParamsSchema = orgParamsSchema.extend({ sessionId: z.string().regex(BILLING_SESSION_ID_RE) });

// Test-only knob so the timeout path does not need a 15 second wait.
let timeoutOverrideMs: number | undefined;
export function setBillingTimeoutForTests(ms: number | undefined): void {
  timeoutOverrideMs = ms;
}

const rateLimit = { max: 60, timeWindow: '1 minute' };

/**
 * In-app billing proxy. Registered inside the organizations plugin (so the
 * plugin-level authenticate hook applies) and only when the billing seam is
 * active. LogTide checks who the caller is; the billing service does the rest.
 */
export async function billingRoutes(fastify: FastifyInstance) {
  async function guard(request: any, reply: FastifyReply, orgId: string) {
    const role = await organizationsService.getMemberRole(orgId, request.user.id);
    if (!role) {
      reply.status(404).send({ error: 'not_found', message: 'Organization not found' });
      return null;
    }
    if (role !== 'owner' && role !== 'admin') {
      reply.status(403).send({ error: 'billing_forbidden', message: 'Only organization owners and admins can manage billing' });
      return null;
    }
    return role;
  }

  async function proxy(
    request: any,
    reply: FastifyReply,
    orgId: string,
    method: 'GET' | 'POST',
    tail: string,
    body?: unknown
  ) {
    const role = await guard(request, reply, orgId);
    if (!role) return reply;
    const result = await forwardToBilling({
      method,
      orgId,
      tail,
      body,
      caller: { id: request.user.id, email: request.user.email, role },
      timeoutMs: timeoutOverrideMs,
    });
    return reply.status(result.status).send(result.body);
  }

  function invalid(reply: FastifyReply, message: string) {
    return reply.status(400).send({ error: 'invalid_request', message });
  }

  const opts = { config: { rateLimit } };

  const simpleGets: Array<[string, string]> = [
    ['/:id/billing', ''],
    ['/:id/billing/invoices', '/invoices'],
  ];
  for (const [path, tail] of simpleGets) {
    fastify.get(path, opts, async (request: any, reply) => {
      const params = orgParamsSchema.safeParse(request.params);
      if (!params.success) return invalid(reply, 'Invalid organization ID format');
      return proxy(request, reply, params.data.id, 'GET', tail);
    });
  }

  fastify.get('/:id/billing/checkout/:sessionId', opts, async (request: any, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, 'Invalid organization or checkout session ID');
    return proxy(request, reply, params.data.id, 'GET', `/checkout/${params.data.sessionId}`);
  });

  for (const tail of ['/checkout', '/preview', '/change']) {
    fastify.post(`/:id/billing${tail}`, opts, async (request: any, reply) => {
      const params = orgParamsSchema.safeParse(request.params);
      if (!params.success) return invalid(reply, 'Invalid organization ID format');
      const body = billingPlanChangeSchema.safeParse(request.body);
      if (!body.success) return invalid(reply, 'Body must be { plan: "pro" | "pro_plus", interval: "month" | "year" }');
      return proxy(request, reply, params.data.id, 'POST', tail, body.data);
    });
  }

  for (const tail of ['/cancel', '/resume', '/payment-method']) {
    fastify.post(`/:id/billing${tail}`, opts, async (request: any, reply) => {
      const params = orgParamsSchema.safeParse(request.params);
      if (!params.success) return invalid(reply, 'Invalid organization ID format');
      return proxy(request, reply, params.data.id, 'POST', tail);
    });
  }
}
