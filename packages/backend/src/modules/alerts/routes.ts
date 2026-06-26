import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LOG_LEVELS, metadataFiltersSchema } from '@logtide/shared';
import { context } from '@logtide/shared/context';
import { alertsService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import { projectsService } from '../projects/service.js';
import { notificationChannelsService } from '../notification-channels/index.js';
import { auditLogService } from '../audit-log/index.js';
import { assertWithinLimit, withLimitLock } from '../../capabilities/index.js';

const organizationsService = new OrganizationsService();

const levelEnum = z.enum(LOG_LEVELS);
const alertTypeEnum = z.enum(['threshold', 'rate_of_change']);
const baselineTypeEnum = z.enum(['same_time_yesterday', 'same_day_last_week', 'rolling_7d_avg', 'percentile_p95']);

const createAlertRuleSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional(),
  service: z.string().max(100).optional().nullable(),
  level: z.array(levelEnum).min(1),
  threshold: z.number().int().min(1),
  timeWindow: z.number().int().min(1),
  alertType: alertTypeEnum.optional(),
  baselineType: baselineTypeEnum.optional().nullable(),
  deviationMultiplier: z.number().min(1.5).max(20).optional().nullable(),
  minBaselineValue: z.number().int().min(0).optional().nullable(),
  cooldownMinutes: z.number().int().min(5).max(1440).optional().nullable(),
  sustainedMinutes: z.number().int().min(1).max(60).optional().nullable(),
  emailRecipients: z.array(z.string().email()).optional(),
  webhookUrl: z.string().url().optional().nullable(),
  channelIds: z.array(z.string().uuid()).optional(),
  metadataFilters: metadataFiltersSchema,
}).refine(
  (data) => (data.emailRecipients && data.emailRecipients.length > 0) || (data.channelIds && data.channelIds.length > 0),
  { message: 'At least one email recipient or notification channel is required' }
).refine(
  (data) => {
    if (data.alertType === 'rate_of_change') {
      return !!data.baselineType && data.deviationMultiplier != null;
    }
    return true;
  },
  { message: 'Rate-of-change alerts require baselineType and deviationMultiplier' }
);

const updateAlertRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  service: z.string().max(100).optional().nullable(),
  level: z.array(levelEnum).min(1).optional(),
  threshold: z.number().int().min(1).optional(),
  timeWindow: z.number().int().min(1).optional(),
  alertType: alertTypeEnum.optional(),
  baselineType: baselineTypeEnum.optional().nullable(),
  deviationMultiplier: z.number().min(1.5).max(20).optional().nullable(),
  minBaselineValue: z.number().int().min(0).optional().nullable(),
  cooldownMinutes: z.number().int().min(5).max(1440).optional().nullable(),
  sustainedMinutes: z.number().int().min(1).max(60).optional().nullable(),
  emailRecipients: z.array(z.string().email()).optional(),
  webhookUrl: z.string().url().optional().nullable(),
  channelIds: z.array(z.string().uuid()).optional(),
  metadataFilters: metadataFiltersSchema.optional(),
}).refine(
  (data) => {
    if (data.alertType === 'rate_of_change') {
      return !!data.baselineType && data.deviationMultiplier != null;
    }
    return true;
  },
  { message: 'Rate-of-change alerts require baselineType and deviationMultiplier' }
);

const alertRuleIdSchema = z.object({
  id: z.string().uuid('Invalid alert rule ID format'),
});

const getAlertsQuerySchema = z.object({
  organizationId: z.string().uuid('organizationId must be a valid uuid'),
  projectId: z.string().uuid().optional(),
  enabledOnly: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

const parsePositiveInt = (val: string | undefined, fallback: number, max: number): number => {
  if (!val) return fallback;
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 0) return fallback;
  return Math.min(n, max);
};

const getHistoryQuerySchema = z.object({
  organizationId: z.string().uuid('organizationId must be a valid uuid'),
  projectId: z.string().uuid().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => parsePositiveInt(val, 100, 500)),
  offset: z
    .string()
    .optional()
    .transform((val) => parsePositiveInt(val, 0, 100000)),
});

const orgQuerySchema = z.object({
  organizationId: z.string().uuid('organizationId must be a valid uuid'),
});

const previewAlertRuleSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid().optional().nullable(),
  service: z.string().max(100).optional().nullable(),
  level: z.array(levelEnum).min(1),
  threshold: z.number().int().min(1),
  timeWindow: z.number().int().min(1).max(1440), // Max 24 hours
  previewRange: z.enum(['1d', '7d', '14d', '30d']),
});

/**
 * Check if user is member of organization
 */
async function checkOrganizationMembership(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const organizations = await organizationsService.getUserOrganizations(userId);
  return organizations.some((org) => org.id === organizationId);
}

/**
 * Enrich alert rule with channelIds
 */
async function enrichAlertRuleWithChannels<T extends { id: string }>(
  alertRule: T
): Promise<T & { channelIds: string[] }> {
  const channels = await notificationChannelsService.getAlertRuleChannels(alertRule.id);
  return {
    ...alertRule,
    channelIds: channels.map((c) => c.id),
  };
}

/**
 * Enrich multiple alert rules with channelIds
 */
async function enrichAlertRulesWithChannels<T extends { id: string }>(
  alertRules: T[]
): Promise<Array<T & { channelIds: string[] }>> {
  return Promise.all(alertRules.map(enrichAlertRuleWithChannels));
}

export async function alertsRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // Create alert rule
  fastify.post('/', async (request: any, reply) => {
    try {
      const body = createAlertRuleSchema.parse(request.body);

      // Check if user is member of organization
      const isMember = await checkOrganizationMembership(request.user.id, body.organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      // Ensure the supplied project actually belongs to the organization.
      // Org membership alone does not authorize an arbitrary projectId.
      if (body.projectId && !(await projectsService.projectBelongsToOrg(body.projectId, body.organizationId))) {
        return reply.status(403).send({
          error: 'Project does not belong to this organization',
        });
      }

      // Capability: enforce the alerts.max_rules static cap before creating.
      // Session-auth requests don't populate request.organizationId in the ALS
      // context, so we establish a scoped system context with the org from the
      // validated body. Same pattern as otlp/trace-routes.ts.
      // The count -> insert is serialized per org via withLimitLock so concurrent
      // creates can't race past the cap.
      const { channelIds, alertType, baselineType, deviationMultiplier, minBaselineValue, cooldownMinutes, sustainedMinutes, metadataFilters, ...alertData } = body;
      const alertRule = await withLimitLock(body.organizationId, 'alerts.max_rules', async () => {
        await context.runAsSystem('alerts:create-limit-check', async () => {
          await context.with({ organizationId: body.organizationId }, async () => {
            const currentRuleCount = await alertsService.countAlertRules(body.organizationId);
            await assertWithinLimit('alerts.max_rules', currentRuleCount);
          });
        });
        return alertsService.createAlertRule({
          ...alertData,
          alertType: alertType || 'threshold',
          baselineType: baselineType || null,
          deviationMultiplier: deviationMultiplier ?? null,
          minBaselineValue: minBaselineValue ?? null,
          cooldownMinutes: cooldownMinutes ?? null,
          sustainedMinutes: sustainedMinutes ?? null,
          emailRecipients: alertData.emailRecipients || [],
          metadataFilters: metadataFilters ?? [],
        });
      });

      // Associate channels with the alert rule
      if (channelIds && channelIds.length > 0) {
        await notificationChannelsService.setAlertRuleChannels(alertRule.id, channelIds, body.organizationId);
      }

      const enrichedRule = await enrichAlertRuleWithChannels(alertRule);

      await auditLogService.record({
        action: 'rule.created',
        target: { type: 'alert_rule', id: alertRule.id },
        organizationId: body.organizationId,
        metadata: { name: alertRule.name, threshold: alertRule.threshold },
      });

      return reply.status(201).send({ alertRule: enrichedRule });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      throw error;
    }
  });

  // Get alert rules for organization
  fastify.get('/', async (request: any, reply) => {
    try {
      const query = getAlertsQuerySchema.parse(request.query);
      const { organizationId } = query;

      // Check if user is member of organization
      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const alertRules = await alertsService.getAlertRules(organizationId, {
        projectId: query.projectId,
        enabledOnly: query.enabledOnly,
      });

      const enrichedRules = await enrichAlertRulesWithChannels(alertRules);
      return reply.send({ alertRules: enrichedRules });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      throw error;
    }
  });

  // Get alert history (must be before /:id to avoid route conflict)
  fastify.get('/history', async (request: any, reply) => {
    try {
      const query = getHistoryQuerySchema.parse(request.query);
      const { organizationId } = query;

      // Check if user is member of organization
      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const history = await alertsService.getAlertHistory(organizationId, {
        projectId: query.projectId,
        limit: query.limit,
        offset: query.offset,
      });

      return reply.send(history);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      throw error;
    }
  });

  // Preview alert rule (must be before /:id to avoid route conflict)
  fastify.post('/preview', async (request: any, reply) => {
    try {
      const body = previewAlertRuleSchema.parse(request.body);

      // Check if user is member of organization
      const isMember = await checkOrganizationMembership(request.user.id, body.organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      // Ensure the supplied project actually belongs to the organization.
      // Without this check a user could preview another tenant's logs by
      // pairing their own orgId with a known foreign projectId.
      if (body.projectId && !(await projectsService.projectBelongsToOrg(body.projectId, body.organizationId))) {
        return reply.status(403).send({
          error: 'Project does not belong to this organization',
        });
      }

      const preview = await alertsService.previewAlertRule(body);

      return reply.send({ preview });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      throw error;
    }
  });

  // Get alert rule by ID
  fastify.get('/:id', async (request: any, reply) => {
    try {
      const { id } = alertRuleIdSchema.parse(request.params);
      const { organizationId } = orgQuerySchema.parse(request.query);

      // Check if user is member of organization
      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const alertRule = await alertsService.getAlertRule(id, organizationId);

      if (!alertRule) {
        return reply.status(404).send({
          error: 'Alert rule not found',
        });
      }

      const enrichedRule = await enrichAlertRuleWithChannels(alertRule);
      return reply.send({ alertRule: enrichedRule });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid alert rule ID format',
        });
      }

      throw error;
    }
  });

  // Update alert rule
  fastify.put('/:id', async (request: any, reply) => {
    try {
      const { id } = alertRuleIdSchema.parse(request.params);
      const body = updateAlertRuleSchema.parse(request.body);
      const { organizationId } = orgQuerySchema.parse(request.query);

      // Check if user is member of organization
      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const { channelIds, alertType, baselineType, deviationMultiplier, minBaselineValue, cooldownMinutes, sustainedMinutes, metadataFilters, ...updateData } = body;
      const rateOfChangeFields: Record<string, unknown> = {};
      if (alertType !== undefined) rateOfChangeFields.alertType = alertType;
      if (baselineType !== undefined) rateOfChangeFields.baselineType = baselineType;
      if (deviationMultiplier !== undefined) rateOfChangeFields.deviationMultiplier = deviationMultiplier;
      if (minBaselineValue !== undefined) rateOfChangeFields.minBaselineValue = minBaselineValue;
      if (cooldownMinutes !== undefined) rateOfChangeFields.cooldownMinutes = cooldownMinutes;
      if (sustainedMinutes !== undefined) rateOfChangeFields.sustainedMinutes = sustainedMinutes;
      if (metadataFilters !== undefined) rateOfChangeFields.metadataFilters = metadataFilters;

      const alertRule = await alertsService.updateAlertRule(id, organizationId, {
        ...updateData,
        ...rateOfChangeFields,
      } as any);

      if (!alertRule) {
        return reply.status(404).send({
          error: 'Alert rule not found',
        });
      }

      // Update channels if provided
      if (channelIds !== undefined) {
        await notificationChannelsService.setAlertRuleChannels(id, channelIds, organizationId);
      }

      const enrichedRule = await enrichAlertRuleWithChannels(alertRule);

      await auditLogService.record({
        action: 'rule.updated',
        target: { type: 'alert_rule', id },
        organizationId,
        metadata: { updatedFields: Object.keys(body) },
      });

      return reply.send({ alertRule: enrichedRule });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      throw error;
    }
  });

  // Delete alert rule
  fastify.delete('/:id', async (request: any, reply) => {
    try {
      const { id } = alertRuleIdSchema.parse(request.params);
      const { organizationId } = orgQuerySchema.parse(request.query);

      // Check if user is member of organization
      const isMember = await checkOrganizationMembership(request.user.id, organizationId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'You are not a member of this organization',
        });
      }

      const deleted = await alertsService.deleteAlertRule(id, organizationId);

      if (!deleted) {
        return reply.status(404).send({
          error: 'Alert rule not found',
        });
      }

      await auditLogService.record({
        action: 'rule.deleted',
        target: { type: 'alert_rule', id },
        organizationId,
      });

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid alert rule ID format',
        });
      }

      throw error;
    }
  });
}
