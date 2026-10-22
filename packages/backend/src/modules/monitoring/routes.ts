import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MONITOR_TYPES } from '@logtide/shared';
import { MonitorService } from './service.js';
import { parseTcpTarget, parseHostPort, isValidDnsHostname, isInternalDnsName } from './checker.js';
import type { SslCheckConfig, DnsCheckConfig, UpdateMonitorInput } from './types.js';
import { authenticate } from '../auth/middleware.js';
import { db } from '../../database/index.js';
import { projectsService } from '../projects/service.js';
import { usersService } from '../users/service.js';
import { notificationChannelsService, serializeChannels } from '../notification-channels/index.js';
import { OrganizationsService } from '../organizations/service.js';
import { assertHttpTargetAllowed, resolveAndValidateHost, SsrfBlockedError } from '../../utils/ssrf-guard.js';
import { config, isSmtpConfigured } from '../../config/index.js';
import { statusSubscribersService } from './subscribers.js';

export const monitorService = new MonitorService(db);
const organizationsService = new OrganizationsService();

const uuidSchema = z.string().uuid();

function parseId(params: any): string | null {
  const result = uuidSchema.safeParse(params?.id);
  return result.success ? result.data : null;
}

function parseOrgId(raw: unknown): string | null {
  const result = uuidSchema.safeParse(raw);
  return result.success ? result.data : null;
}

function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (isNaN(n) || n < 1) return fallback;
  return Math.min(n, max);
}

async function checkOrgMembership(userId: string, organizationId: string): Promise<boolean> {
  const member = await db
    .selectFrom('organization_members')
    .select('id')
    .where('user_id', '=', userId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  return !!member;
}

/**
 * Validate an HTTP/TCP monitor target against the SSRF guard so a user can't
 * store a monitor that probes internal services. Returns an error message if
 * the target is disallowed, or null if it's fine. Heartbeat/log monitors have
 * no outbound network target.
 */
async function validateMonitorTarget(
  type: string,
  target: string | null | undefined
): Promise<string | null> {
  if (!target) return null;
  const allowPrivate = config.MONITOR_ALLOW_PRIVATE_TARGETS;
  try {
    if (type === 'http') {
      await assertHttpTargetAllowed(target, allowPrivate);
    } else if (type === 'tcp') {
      const { host } = parseTcpTarget(target);
      await resolveAndValidateHost(host, allowPrivate);
    } else if (type === 'ssl') {
      const { host } = parseHostPort(target, 443);
      await resolveAndValidateHost(host, allowPrivate);
    } else if (type === 'dns') {
      // No connection is made, but the system resolver answers for internal
      // names (Docker and Kubernetes services), which would leak addresses.
      if (!allowPrivate && isInternalDnsName(target)) {
        return 'Internal hostnames are not allowed for DNS monitors';
      }
    }
    return null;
  } catch (err) {
    if (err instanceof SsrfBlockedError) return err.message;
    return 'Could not validate monitor target';
  }
}

const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

const httpHeadersSchema = z
  .record(z.string().max(1024, 'Header value must be at most 1024 characters'))
  .refine((h) => Object.keys(h).length <= 20, { message: 'At most 20 headers are allowed' })
  .refine((h) => Object.keys(h).every((name) => HEADER_NAME_PATTERN.test(name)), {
    message: 'Header names may contain only letters, digits and hyphens (1 to 64 characters)',
  });

const httpConfigSchema = z.object({
  method: z
    .string()
    .transform((m) => m.toUpperCase())
    .pipe(z.enum(HTTP_METHODS, { errorMap: () => ({ message: 'Unsupported HTTP method' }) }))
    .optional(),
  expectedStatus: z.number().int().min(100).max(599).optional(),
  headers: httpHeadersSchema.optional(),
  bodyAssertion: z.union([
    z.object({ type: z.literal('contains'), value: z.string().min(1).max(10000) }),
    z.object({ type: z.literal('regex'), pattern: z.string().min(1).max(256) }),
  ]).optional(),
}).optional().nullable();

const emptyToNull = (v: string | null | undefined) => {
  if (v === undefined || v === null) return v;
  const t = v.trim();
  return t.length === 0 ? null : t;
};
const displayNameSchema = z.string().max(255).transform(emptyToNull).nullable().optional();
const groupNameSchema = z.string().max(100).transform(emptyToNull).nullable().optional();
const displayOrderSchema = z.number().int().min(0).max(100000).optional();

const sslCheckConfigSchema = z.object({ warnDays: z.number().int().min(1).max(365) }).strict();
const dnsCheckConfigSchema = z
  .object({
    recordType: z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT']),
    expectedValue: z.string().trim().max(255).optional(),
  })
  .strict();

/**
 * Validate and normalise the per-type checkConfig. ssl defaults to warnDays 14
 * and dns to record type A; other types carry no config.
 */
export function parseCheckConfig(
  type: string,
  raw: unknown
): { ok: true; value: SslCheckConfig | DnsCheckConfig | null } | { ok: false; error: string } {
  if (type === 'ssl') {
    if (raw === undefined || raw === null) return { ok: true, value: { warnDays: 14 } };
    const parsed = sslCheckConfigSchema.safeParse(raw);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, error: 'Invalid ssl check config: warnDays must be between 1 and 365' };
  }
  if (type === 'dns') {
    if (raw === undefined || raw === null) return { ok: true, value: { recordType: 'A' } };
    const parsed = dnsCheckConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: 'Invalid dns check config: recordType must be A, AAAA, CNAME, MX or TXT' };
    }
    const { recordType, expectedValue } = parsed.data;
    return { ok: true, value: expectedValue ? { recordType, expectedValue } : { recordType } };
  }
  return { ok: true, value: null };
}

function isValidSslTarget(target: string): boolean {
  if (target.includes('://') || /[\s/?#@]/.test(target)) return false;
  try {
    parseHostPort(target, 443);
    return true;
  } catch {
    return false;
  }
}

const createMonitorSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  type: z.enum(MONITOR_TYPES),
  target: z.string().optional().nullable(),
  intervalSeconds: z.number().int().min(30).max(86400).optional(),
  timeoutSeconds: z.number().int().min(1).max(60).optional(),
  gracePeriodSeconds: z.number().int().min(60).max(86400).optional().nullable(),
  failureThreshold: z.number().int().min(1).max(20).optional(),
  autoResolve: z.boolean().optional(),
  enabled: z.boolean().optional(),
  httpConfig: httpConfigSchema,
  severity: z.enum(['critical', 'high', 'medium', 'low', 'informational']).optional(),
  displayName: displayNameSchema,
  groupName: groupNameSchema,
  displayOrder: displayOrderSchema,
  checkConfig: z.unknown().optional(),
}).refine(
  (d) => {
    if (d.type === 'http') return !!d.target && (d.target.startsWith('http://') || d.target.startsWith('https://'));
    if (d.type === 'tcp') return !!d.target && d.target.includes(':');
    if (d.type === 'log_heartbeat') return !!d.target && d.target.trim().length > 0;
    if (d.type === 'ssl') return !!d.target && isValidSslTarget(d.target);
    if (d.type === 'dns') return !!d.target && isValidDnsHostname(d.target);
    return true;
  },
  { message: 'Invalid target for monitor type' }
);

const updateMonitorSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  target: z.string().nullable().optional(),
  intervalSeconds: z.number().int().min(30).max(86400).optional(),
  timeoutSeconds: z.number().int().min(1).max(60).optional(),
  gracePeriodSeconds: z.number().int().min(60).max(86400).optional().nullable(),
  failureThreshold: z.number().int().min(1).max(20).optional(),
  autoResolve: z.boolean().optional(),
  enabled: z.boolean().optional(),
  httpConfig: httpConfigSchema,
  severity: z.enum(['critical', 'high', 'medium', 'low', 'informational']).optional(),
  displayName: displayNameSchema,
  groupName: groupNameSchema,
  displayOrder: displayOrderSchema,
  checkConfig: z.unknown().optional(),
});

// ============================================================================
// Authenticated management routes (session required)
// ============================================================================

export async function monitoringRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  fastify.get('/', async (request: any, reply) => {
    const { organizationId, projectId } = request.query as any;
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgMembership(request.user.id, organizationId))) return reply.status(403).send({ error: 'Forbidden' });

    const monitors = await monitorService.listMonitors(organizationId, projectId);
    return reply.send({ monitors });
  });

  fastify.get('/:id', async (request: any, reply) => {
    const id = parseId(request.params);
    if (!id) return reply.status(400).send({ error: 'Invalid monitor ID' });
    const organizationId = parseOrgId((request.query as any).organizationId);
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgMembership(request.user.id, organizationId))) return reply.status(403).send({ error: 'Forbidden' });

    const monitor = await monitorService.getMonitor(id, organizationId);
    if (!monitor) return reply.status(404).send({ error: 'Not found' });
    return reply.send({ monitor });
  });

  fastify.post('/', async (request: any, reply) => {
    const parse = createMonitorSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send({ error: parse.error.errors[0].message });
    const input = parse.data;
    if (!(await checkOrgMembership(request.user.id, input.organizationId))) return reply.status(403).send({ error: 'Forbidden' });

    // The projectId is untrusted - verify it belongs to the org so a member
    // can't inject a monitor into another tenant's project / status page.
    if (!(await projectsService.projectBelongsToOrg(input.projectId, input.organizationId))) {
      return reply.status(403).send({ error: 'Project does not belong to this organization' });
    }

    // Reject SSRF targets (internal/private addresses) before storing.
    const targetError = await validateMonitorTarget(input.type, input.target);
    if (targetError) return reply.status(400).send({ error: targetError });

    const checkConfig = parseCheckConfig(input.type, input.checkConfig);
    if (!checkConfig.ok) return reply.status(400).send({ error: checkConfig.error });

    const monitor = await monitorService.createMonitor({ ...input, checkConfig: checkConfig.value });
    return reply.status(201).send({ monitor });
  });

  fastify.put('/:id', async (request: any, reply) => {
    const id = parseId(request.params);
    if (!id) return reply.status(400).send({ error: 'Invalid monitor ID' });
    const organizationId = parseOrgId((request.query as any).organizationId);
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgMembership(request.user.id, organizationId))) return reply.status(403).send({ error: 'Forbidden' });

    const parse = updateMonitorSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send({ error: parse.error.errors[0].message });

    const { checkConfig: rawCheckConfig, ...updateFields } = parse.data;
    const update: UpdateMonitorInput = updateFields;

    // checkConfig is validated against the type of the stored monitor
    if (rawCheckConfig !== undefined) {
      const existingForConfig = await monitorService.getMonitor(id, organizationId);
      if (!existingForConfig) return reply.status(404).send({ error: 'Not found' });
      const checkConfig = parseCheckConfig(existingForConfig.type, rawCheckConfig);
      if (!checkConfig.ok) return reply.status(400).send({ error: checkConfig.error });
      update.checkConfig = checkConfig.value;
    }

    // Validate target format against monitor type if target is being changed
    if (parse.data.target) {
      const existing = await monitorService.getMonitor(id, organizationId);
      if (!existing) return reply.status(404).send({ error: 'Not found' });
      if (existing.type === 'http' && !(parse.data.target.startsWith('http://') || parse.data.target.startsWith('https://'))) {
        return reply.status(400).send({ error: 'HTTP target must start with http:// or https://' });
      }
      if (existing.type === 'tcp' && !parse.data.target.includes(':')) {
        return reply.status(400).send({ error: 'TCP target must be in host:port format' });
      }
      if (existing.type === 'log_heartbeat' && !parse.data.target?.trim()) {
        return reply.status(400).send({ error: 'Log-based monitor requires a service name' });
      }
      if (existing.type === 'ssl' && !isValidSslTarget(parse.data.target)) {
        return reply.status(400).send({ error: 'SSL target must be host or host:port without a scheme' });
      }
      if (existing.type === 'dns' && !isValidDnsHostname(parse.data.target)) {
        return reply.status(400).send({ error: 'DNS target must be a hostname' });
      }

      // Reject SSRF targets (internal/private addresses) before storing.
      const targetError = await validateMonitorTarget(existing.type, parse.data.target);
      if (targetError) return reply.status(400).send({ error: targetError });
    }

    const monitor = await monitorService.updateMonitor(id, organizationId, update);
    if (!monitor) return reply.status(404).send({ error: 'Not found' });
    return reply.send({ monitor });
  });

  fastify.delete('/:id', async (request: any, reply) => {
    const id = parseId(request.params);
    if (!id) return reply.status(400).send({ error: 'Invalid monitor ID' });
    const organizationId = parseOrgId((request.query as any).organizationId);
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgMembership(request.user.id, organizationId))) return reply.status(403).send({ error: 'Forbidden' });

    await monitorService.deleteMonitor(id, organizationId);
    return reply.status(204).send();
  });

  fastify.get('/:id/results', async (request: any, reply) => {
    const id = parseId(request.params);
    if (!id) return reply.status(400).send({ error: 'Invalid monitor ID' });
    const { organizationId: rawOrgId, limit } = request.query as any;
    const organizationId = parseOrgId(rawOrgId);
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgMembership(request.user.id, organizationId))) return reply.status(403).send({ error: 'Forbidden' });

    const results = await monitorService.getRecentResults(
      id, organizationId, parsePositiveInt(limit, 50, 200)
    );
    return reply.send({ results });
  });

  fastify.get('/:id/uptime', async (request: any, reply) => {
    const id = parseId(request.params);
    if (!id) return reply.status(400).send({ error: 'Invalid monitor ID' });
    const { organizationId: rawOrgId, days } = request.query as any;
    const organizationId = parseOrgId(rawOrgId);
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgMembership(request.user.id, organizationId))) return reply.status(403).send({ error: 'Forbidden' });

    const history = await monitorService.getUptimeHistory(
      id, organizationId, parsePositiveInt(days, 90, 365)
    );
    return reply.send({ history });
  });

  fastify.get('/:id/uptime-summary', async (request: any, reply) => {
    const id = parseId(request.params);
    if (!id) return reply.status(400).send({ error: 'Invalid monitor ID' });
    const organizationId = parseOrgId((request.query as any).organizationId);
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgMembership(request.user.id, organizationId))) return reply.status(403).send({ error: 'Forbidden' });

    const summary = await monitorService.getUptimeSummary(id, organizationId);
    if (!summary) return reply.status(404).send({ error: 'Not found' });
    return reply.send(summary);
  });

  fastify.get('/:id/response-times', async (request: any, reply) => {
    const id = parseId(request.params);
    if (!id) return reply.status(400).send({ error: 'Invalid monitor ID' });
    const { organizationId: rawOrgId, range } = request.query as any;
    const organizationId = parseOrgId(rawOrgId);
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    const parsedRange = z.enum(['24h', '7d', '30d']).safeParse(range ?? '24h');
    if (!parsedRange.success) return reply.status(400).send({ error: 'range must be 24h, 7d or 30d' });
    if (!(await checkOrgMembership(request.user.id, organizationId))) return reply.status(403).send({ error: 'Forbidden' });

    const result = await monitorService.getResponseTimes(id, organizationId, parsedRange.data);
    if (!result) return reply.status(404).send({ error: 'Not found' });
    return reply.send(result);
  });

  fastify.get('/:id/outages', async (request: any, reply) => {
    const id = parseId(request.params);
    if (!id) return reply.status(400).send({ error: 'Invalid monitor ID' });
    const { organizationId: rawOrgId, limit } = request.query as any;
    const organizationId = parseOrgId(rawOrgId);
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgMembership(request.user.id, organizationId))) return reply.status(403).send({ error: 'Forbidden' });

    const result = await monitorService.getOutages(id, organizationId, parsePositiveInt(limit, 20, 100));
    if (!result) return reply.status(404).send({ error: 'Not found' });
    return reply.send(result);
  });

  // ---- Notification channels for monitors ----

  fastify.get('/:id/channels', async (request: any, reply) => {
    const id = parseId(request.params);
    if (!id) return reply.status(400).send({ error: 'Invalid monitor ID' });
    const organizationId = parseOrgId((request.query as any).organizationId);
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgMembership(request.user.id, organizationId))) return reply.status(403).send({ error: 'Forbidden' });

    const monitor = await monitorService.getMonitor(id, organizationId);
    if (!monitor) return reply.status(404).send({ error: 'Not found' });

    const channels = await notificationChannelsService.getMonitorChannels(id);
    const isAdmin = await organizationsService.isOwnerOrAdmin(organizationId, request.user.id);
    return reply.send({ channels: serializeChannels(channels, { isAdmin }) });
  });

  fastify.put('/:id/channels', async (request: any, reply) => {
    const id = parseId(request.params);
    if (!id) return reply.status(400).send({ error: 'Invalid monitor ID' });
    const organizationId = parseOrgId((request.query as any).organizationId);
    if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
    if (!(await checkOrgMembership(request.user.id, organizationId))) return reply.status(403).send({ error: 'Forbidden' });

    const parse = z.object({ channelIds: z.array(z.string().uuid()) }).safeParse(request.body);
    if (!parse.success) return reply.status(400).send({ error: parse.error.errors[0].message });

    const monitor = await monitorService.getMonitor(id, organizationId);
    if (!monitor) return reply.status(404).send({ error: 'Not found' });

    await notificationChannelsService.setMonitorChannels(id, parse.data.channelIds, organizationId);
    return reply.status(204).send();
  });
}

// ============================================================================
// Heartbeat endpoint - accepts API key auth OR session auth
// The global auth plugin already validates API keys and sets request.organizationId.
// No additional authenticate hook needed here.
// ============================================================================

export async function heartbeatRoutes(fastify: FastifyInstance) {
  fastify.post('/:id/heartbeat', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request: any, reply) => {
    const monitorId = request.params.id;

    // API key path: global auth plugin set organizationId and the key-bound projectId.
    if (request.organizationId) {
      await monitorService.recordHeartbeat(monitorId, request.organizationId, request.projectId);
      return reply.status(204).send();
    }

    // Session path: organizationId from query
    if (request.user) {
      const { organizationId } = request.query as any;
      if (!organizationId) return reply.status(400).send({ error: 'organizationId required' });
      if (!(await checkOrgMembership(request.user.id, organizationId))) return reply.status(403).send({ error: 'Forbidden' });
      await monitorService.recordHeartbeat(monitorId, organizationId);
      return reply.status(204).send();
    }

    return reply.status(401).send({ error: 'Unauthorized' });
  });
}

// ============================================================================
// Public status page - no auth, scrubbed data
// ============================================================================

/** Subscribe work running after its response was sent (see the subscribe route). */
const pendingSubscribes = new Set<Promise<void>>();

/** Resolves once every subscribe started so far has finished. Used by tests. */
export async function settleSubscribeWork(): Promise<void> {
  while (pendingSubscribes.size > 0) {
    await Promise.all([...pendingSubscribes]);
  }
}

export async function publicStatusRoutes(fastify: FastifyInstance) {
  fastify.get('/:orgSlug/:projectSlug', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request: any, reply) => {
    const { orgSlug, projectSlug } = request.params as { orgSlug: string; projectSlug: string };
    const project = await monitorService.getProjectByOrgAndSlug(orgSlug, projectSlug);
    if (!project || project.status_page_visibility === 'disabled') {
      return reply.status(404).send({ error: 'Not found' });
    }

    // Password-protected
    if (project.status_page_visibility === 'password') {
      const password = request.headers['x-status-password'];
      if (!password) {
        return reply.status(401).send({ requiresPassword: true });
      }
      const valid = await projectsService.verifyStatusPagePassword(project.id, password);
      if (!valid) {
        return reply.status(401).send({ requiresPassword: true, error: 'Invalid password' });
      }
    }

    // Members only
    if (project.status_page_visibility === 'members_only') {
      const authHeader = request.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
      if (!token) {
        return reply.status(401).send({ requiresAuth: true });
      }
      const user = await usersService.validateSession(token);
      if (!user) {
        return reply.status(401).send({ requiresAuth: true });
      }
      // Check org membership
      const member = await db
        .selectFrom('organization_members')
        .select('id')
        .where('user_id', '=', user.id)
        .where('organization_id', '=', project.organization_id)
        .executeTakeFirst();
      if (!member) {
        return reply.status(403).send({ error: 'Not a member of this organization' });
      }
    }

    const status = await monitorService.getPublicStatus(project.slug, project.id);
    if (!status) return reply.status(404).send({ error: 'Not found' });
    return reply.send(status);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Email subscriptions (double opt-in)
  // ──────────────────────────────────────────────────────────────────────
  // Subscribing is only offered on public pages with SMTP configured. The
  // answer never depends on whether the address is already known. Confirm and
  // unsubscribe are POST so mail scanners prefetching links change nothing; they
  // keep working when the page is no longer public, so nobody gets stuck.

  const subscribeBodySchema = z.object({ email: z.string().trim().email().max(254) });
  const tokenBodySchema = z.object({ token: z.string().min(1).max(200) });

  // Keyed on the client address only. The global generator keys on a hash of
  // any X-Api-Key / Authorization header, which a caller controls: these
  // routes skip authentication, so a random header would mint a fresh bucket
  // per request and defeat the limit.
  const keyByIp = (request: { ip: string }) => `status-subscription:${request.ip}`;

  fastify.post('/:orgSlug/:projectSlug/subscribe', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: keyByIp } },
  }, async (request: any, reply) => {
    const { orgSlug, projectSlug } = request.params as { orgSlug: string; projectSlug: string };
    const project = await monitorService.getProjectByOrgAndSlug(orgSlug, projectSlug);
    if (!project || project.status_page_visibility !== 'public' || !isSmtpConfigured()) {
      return reply.status(404).send({ error: 'Not found' });
    }
    const parse = subscribeBodySchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send({ error: 'Enter a valid email address' });

    // Fire and forget: the lookup, the write and the SMTP send run after the
    // response, so timing never tells a known address from a new one (same
    // approach as the password reset request).
    const work: Promise<void> = statusSubscribersService
      .subscribe({
        organizationId: project.organization_id,
        projectId: project.id,
        orgSlug,
        projectSlug: project.slug,
        projectName: project.name,
        email: parse.data.email,
      })
      .catch((err) => {
        console.error('[StatusSubscribers] subscribe failed:', err instanceof Error ? err.message : err);
      })
      .finally(() => {
        pendingSubscribes.delete(work);
      });
    pendingSubscribes.add(work);
    return reply.status(202).send({ ok: true });
  });

  fastify.post('/:orgSlug/:projectSlug/subscribe/confirm', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: keyByIp } },
  }, async (request: any, reply) => {
    const { orgSlug, projectSlug } = request.params as { orgSlug: string; projectSlug: string };
    const project = await monitorService.getProjectByOrgAndSlug(orgSlug, projectSlug);
    const parse = tokenBodySchema.safeParse(request.body);
    if (!project || !parse.success) return reply.status(400).send({ error: 'Invalid or expired link' });
    const ok = await statusSubscribersService.confirm(project.organization_id, project.id, parse.data.token);
    if (!ok) return reply.status(400).send({ error: 'Invalid or expired link' });
    return reply.send({ ok: true });
  });

  fastify.post('/:orgSlug/:projectSlug/unsubscribe', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: keyByIp } },
  }, async (request: any, reply) => {
    const { orgSlug, projectSlug } = request.params as { orgSlug: string; projectSlug: string };
    const project = await monitorService.getProjectByOrgAndSlug(orgSlug, projectSlug);
    const parse = tokenBodySchema.safeParse(request.body);
    if (!project || !parse.success) return reply.status(400).send({ error: 'Invalid or expired link' });
    const ok = await statusSubscribersService.unsubscribe(project.organization_id, project.id, parse.data.token);
    if (!ok) return reply.status(400).send({ error: 'Invalid or expired link' });
    return reply.send({ ok: true });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Embed badges - JSON + SVG
  // ──────────────────────────────────────────────────────────────────────
  // These are dedicated lightweight endpoints for embedding the project's
  // overall status on third-party websites (README badges, blog posts,
  // status widgets). They only work for projects with status_page_visibility
  // set to 'public' - password / members_only projects do NOT expose a
  // badge, since the whole point of a badge is anonymous embedding.

  function badgeMeta(s: 'operational' | 'degraded' | 'outage' | 'unknown') {
    if (s === 'operational') return { label: 'all systems operational', color: '#16a34a' };
    if (s === 'degraded') return { label: 'partial outage', color: '#eab308' };
    if (s === 'outage') return { label: 'major outage', color: '#dc2626' };
    return { label: 'unknown', color: '#6b7280' };
  }

  function escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  type BadgeStyle = 'flat' | 'flat-square' | 'plastic' | 'for-the-badge' | 'minimal';

  const BADGE_STYLES: ReadonlySet<BadgeStyle> = new Set([
    'flat',
    'flat-square',
    'plastic',
    'for-the-badge',
    'minimal',
  ]);

  function parseBadgeStyle(s: unknown): BadgeStyle {
    if (typeof s === 'string' && BADGE_STYLES.has(s as BadgeStyle)) return s as BadgeStyle;
    return 'flat';
  }

  // ── Generic two-tone shield badges (flat / flat-square / plastic) ──────
  function renderShieldBadge(
    label: string,
    color: string,
    opts: { rx: number; gradient: boolean; height?: number }
  ): string {
    const leftText = 'status';
    const fontSize = 11;
    const charW = 6.2;
    const padX = 7;
    const leftW = Math.round(leftText.length * charW + padX * 2);
    const rightW = Math.round(label.length * charW + padX * 2);
    const totalW = leftW + rightW;
    const h = opts.height ?? 20;

    const safeLabel = escapeXml(label);
    const leftCenter = leftW / 2;
    const rightCenter = leftW + rightW / 2;
    const textY = h - 6;

    const gradientDef = opts.gradient
      ? `<linearGradient id="g" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".15"/>
    <stop offset="1" stop-color="#000" stop-opacity=".15"/>
  </linearGradient>`
      : '';
    const gradientOverlay = opts.gradient
      ? `<rect width="${totalW}" height="${h}" fill="url(#g)"/>`
      : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${h}" role="img" aria-label="status: ${safeLabel}">
  <title>status: ${safeLabel}</title>
  ${gradientDef}
  <clipPath id="c"><rect width="${totalW}" height="${h}" rx="${opts.rx}" fill="#fff"/></clipPath>
  <g clip-path="url(#c)">
    <rect width="${leftW}" height="${h}" fill="#555"/>
    <rect x="${leftW}" width="${rightW}" height="${h}" fill="${color}"/>
    ${gradientOverlay}
  </g>
  <g fill="#fff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="${fontSize}" text-anchor="middle">
    <text x="${leftCenter}" y="${textY}" fill="#010101" fill-opacity=".3">${leftText}</text>
    <text x="${leftCenter}" y="${textY - 1}">${leftText}</text>
    <text x="${rightCenter}" y="${textY}" fill="#010101" fill-opacity=".3">${safeLabel}</text>
    <text x="${rightCenter}" y="${textY - 1}">${safeLabel}</text>
  </g>
</svg>`;
  }

  // ── Big block-style badge (for-the-badge) ──────────────────────────────
  function renderForTheBadge(label: string, color: string): string {
    const leftText = 'STATUS';
    const upperLabel = label.toUpperCase();
    const fontSize = 10;
    const charW = 7.5; // wider for uppercase + letter spacing
    const padX = 12;
    const leftW = Math.round(leftText.length * charW + padX * 2);
    const rightW = Math.round(upperLabel.length * charW + padX * 2);
    const totalW = leftW + rightW;
    const h = 28;

    const safeLabel = escapeXml(upperLabel);
    const leftCenter = leftW / 2;
    const rightCenter = leftW + rightW / 2;
    const textY = h / 2 + 4;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${h}" role="img" aria-label="status: ${safeLabel}">
  <title>status: ${safeLabel}</title>
  <g>
    <rect width="${leftW}" height="${h}" fill="#555"/>
    <rect x="${leftW}" width="${rightW}" height="${h}" fill="${color}"/>
  </g>
  <g fill="#fff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="${fontSize}" font-weight="bold" text-anchor="middle" letter-spacing="1.5">
    <text x="${leftCenter}" y="${textY}">${leftText}</text>
    <text x="${rightCenter}" y="${textY}">${safeLabel}</text>
  </g>
</svg>`;
  }

  // ── Minimal pill badge with colored dot ────────────────────────────────
  function renderMinimalBadge(label: string, color: string): string {
    const fontSize = 11;
    const charW = 6.2;
    const padLeft = 22; // room for the dot + spacing
    const padRight = 12;
    const w = Math.round(label.length * charW + padLeft + padRight);
    const h = 22;
    const r = h / 2;
    const safeLabel = escapeXml(label);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="status: ${safeLabel}">
  <title>status: ${safeLabel}</title>
  <rect width="${w}" height="${h}" rx="${r}" fill="#1e293b" stroke="#334155" stroke-width="1"/>
  <circle cx="11" cy="${h / 2}" r="4" fill="${color}"/>
  <circle cx="11" cy="${h / 2}" r="6" fill="${color}" fill-opacity="0.25"/>
  <text x="${padLeft}" y="${h / 2 + 4}" fill="#e2e8f0" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="${fontSize}">${safeLabel}</text>
</svg>`;
  }

  function renderBadgeSvg(label: string, color: string, style: BadgeStyle): string {
    switch (style) {
      case 'flat-square':
        return renderShieldBadge(label, color, { rx: 0, gradient: false });
      case 'plastic':
        return renderShieldBadge(label, color, { rx: 4, gradient: true, height: 18 });
      case 'for-the-badge':
        return renderForTheBadge(label, color);
      case 'minimal':
        return renderMinimalBadge(label, color);
      case 'flat':
      default:
        return renderShieldBadge(label, color, { rx: 3, gradient: true });
    }
  }

  async function loadPublicProjectStatus(orgSlug: string, projectSlug: string): Promise<{ status: 'operational' | 'degraded' | 'outage' | 'unknown'; updatedAt: string } | null> {
    const project = await monitorService.getProjectByOrgAndSlug(orgSlug, projectSlug);
    // Badges are anonymous - only allow strictly public projects
    if (!project || project.status_page_visibility !== 'public') return null;

    const status = await monitorService.getPublicStatus(project.slug, project.id);
    if (!status) return null;

    return {
      status: status.overallStatus as 'operational' | 'degraded' | 'outage',
      updatedAt: status.lastUpdated,
    };
  }

  // Headers needed to make the badges loadable from any third-party origin.
  // Helmet sets `Cross-Origin-Resource-Policy: same-origin` globally which
  // blocks <img src> from cross-origin sites - badges MUST opt out so they
  // can be embedded on README/blog/dashboard from any domain.
  function applyEmbedHeaders(reply: any): any {
    return reply
      .header('Cache-Control', 'public, max-age=60')
      .header('Access-Control-Allow-Origin', '*')
      .header('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  // JSON badge: minimal payload for sites that want to render their own UI
  fastify.get('/:orgSlug/:projectSlug/badge.json', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request: any, reply) => {
    const { orgSlug, projectSlug } = request.params as { orgSlug: string; projectSlug: string };
    const result = await loadPublicProjectStatus(orgSlug, projectSlug);
    if (!result) return reply.status(404).send({ error: 'Not found' });

    const meta = badgeMeta(result.status);
    return applyEmbedHeaders(reply).send({
      status: result.status,
      label: meta.label,
      color: meta.color,
      updatedAt: result.updatedAt,
    });
  });

  // SVG badge: drop-in <img src="..."> for README / blogs / dashboards
  fastify.get('/:orgSlug/:projectSlug/badge.svg', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request: any, reply) => {
    const { orgSlug, projectSlug } = request.params as { orgSlug: string; projectSlug: string };
    const style = parseBadgeStyle((request.query as { style?: string }).style);
    const result = await loadPublicProjectStatus(orgSlug, projectSlug);

    if (!result) {
      // Return an "unknown" badge for missing/private projects so the embed
      // never breaks visually on the consumer site - they just see a grey badge.
      const meta = badgeMeta('unknown');
      const svg = renderBadgeSvg(meta.label, meta.color, style);
      return applyEmbedHeaders(reply)
        .header('Content-Type', 'image/svg+xml; charset=utf-8')
        .send(svg);
    }

    const meta = badgeMeta(result.status);
    const svg = renderBadgeSvg(meta.label, meta.color, style);
    return applyEmbedHeaders(reply)
      .header('Content-Type', 'image/svg+xml; charset=utf-8')
      .send(svg);
  });
}
