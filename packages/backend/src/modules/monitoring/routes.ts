import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MONITOR_TYPES } from '@logtide/shared';
import { MonitorService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { db } from '../../database/index.js';
import { projectsService } from '../projects/service.js';
import { usersService } from '../users/service.js';
import { notificationChannelsService } from '../notification-channels/index.js';

export const monitorService = new MonitorService(db);

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

const httpConfigSchema = z.object({
  method: z.string().optional(),
  expectedStatus: z.number().int().min(100).max(599).optional(),
  headers: z.record(z.string()).optional(),
  bodyAssertion: z.union([
    z.object({ type: z.literal('contains'), value: z.string().min(1).max(10000) }),
    z.object({ type: z.literal('regex'), pattern: z.string().min(1).max(256) }),
  ]).optional(),
}).optional().nullable();

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
}).refine(
  (d) => {
    if (d.type === 'http') return !!d.target && (d.target.startsWith('http://') || d.target.startsWith('https://'));
    if (d.type === 'tcp') return !!d.target && d.target.includes(':');
    if (d.type === 'log_heartbeat') return !!d.target && d.target.trim().length > 0;
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

    const monitor = await monitorService.createMonitor(input);
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
    }

    const monitor = await monitorService.updateMonitor(id, organizationId, parse.data);
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
    return reply.send({ channels });
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

    await notificationChannelsService.setMonitorChannels(id, parse.data.channelIds);
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

    // API key path: global auth plugin set organizationId
    if (request.organizationId) {
      await monitorService.recordHeartbeat(monitorId, request.organizationId);
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

export async function publicStatusRoutes(fastify: FastifyInstance) {
  fastify.get('/project/:slug', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request: any, reply) => {
    const slug = request.params.slug;
    const project = await monitorService.getProjectBySlug(slug);
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

    const status = await monitorService.getPublicStatus(slug, project.id);
    if (!status) return reply.status(404).send({ error: 'Not found' });
    return reply.send(status);
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

  async function loadPublicProjectStatus(slug: string): Promise<{ status: 'operational' | 'degraded' | 'outage' | 'unknown'; updatedAt: string } | null> {
    const project = await monitorService.getProjectBySlug(slug);
    // Badges are anonymous - only allow strictly public projects
    if (!project || project.status_page_visibility !== 'public') return null;

    const status = await monitorService.getPublicStatus(slug, project.id);
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
  fastify.get('/project/:slug/badge.json', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request: any, reply) => {
    const result = await loadPublicProjectStatus(request.params.slug);
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
  fastify.get('/project/:slug/badge.svg', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request: any, reply) => {
    const style = parseBadgeStyle((request.query as { style?: string }).style);
    const result = await loadPublicProjectStatus(request.params.slug);

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
