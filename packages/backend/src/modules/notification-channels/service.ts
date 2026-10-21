/**
 * Notification Channels Service
 * Manages notification channels and sends notifications through them
 */

import { db } from '../../database/connection.js';
import type {
  NotificationChannelType,
  NotificationEventType,
  ChannelConfig,
  NotificationChannel,
  CreateNotificationChannelInput,
  UpdateNotificationChannelInput,
  NotificationContext,
  DeliveryResult,
} from '@logtide/shared';
import type { NotificationProvider } from './providers/interface.js';
import { EmailProvider } from './providers/email-provider.js';
import { WebhookProvider } from './providers/webhook-provider.js';
import { PagerDutyProvider } from './providers/pagerduty-provider.js';
import { mergeConfigSecrets } from './serialize.js';

export class NotificationChannelsService {
  private providers: Map<NotificationChannelType, NotificationProvider>;

  constructor() {
    this.providers = new Map();
    this.providers.set('email', new EmailProvider());
    this.providers.set('webhook', new WebhookProvider());
    this.providers.set('pagerduty', new PagerDutyProvider());
  }

  // ============================================================================
  // CHANNEL CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new notification channel
   */
  async createChannel(
    organizationId: string,
    input: CreateNotificationChannelInput,
    createdBy?: string
  ): Promise<NotificationChannel> {
    // Validate config using provider
    const provider = this.providers.get(input.type);
    if (!provider) {
      throw new Error(`Unsupported channel type: ${input.type}`);
    }

    if (!provider.validateConfig(input.config)) {
      throw new Error(`Invalid configuration for ${input.type} channel`);
    }

    const channel = await db
      .insertInto('notification_channels')
      .values({
        organization_id: organizationId,
        name: input.name,
        type: input.type,
        config: input.config,
        description: input.description || null,
        created_by: createdBy || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapChannel(channel);
  }

  /** Count notification channels for an organization (capability limit input). */
  async countChannels(organizationId: string): Promise<number> {
    const row = await db
      .selectFrom('notification_channels')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /**
   * Get all channels for an organization
   */
  async getChannels(
    organizationId: string,
    options?: { enabledOnly?: boolean; type?: NotificationChannelType }
  ): Promise<NotificationChannel[]> {
    let query = db
      .selectFrom('notification_channels')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .orderBy('name', 'asc');

    if (options?.enabledOnly) {
      query = query.where('enabled', '=', true);
    }

    if (options?.type) {
      query = query.where('type', '=', options.type);
    }

    const rows = await query.execute();
    return rows.map((r) => this.mapChannel(r));
  }

  /**
   * Get a single channel by ID
   */
  async getChannel(id: string, organizationId: string): Promise<NotificationChannel | null> {
    const row = await db
      .selectFrom('notification_channels')
      .selectAll()
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return row ? this.mapChannel(row) : null;
  }

  /**
   * Update a channel
   */
  async updateChannel(
    id: string,
    organizationId: string,
    input: UpdateNotificationChannelInput
  ): Promise<NotificationChannel> {
    // If config is being updated, keep stored secrets the caller did not
    // retype, then validate the merged result.
    let mergedConfig: ChannelConfig | undefined;
    if (input.config) {
      const existing = await this.getChannel(id, organizationId);
      if (!existing) {
        throw new Error('Channel not found');
      }

      mergedConfig = mergeConfigSecrets(existing.config, input.config);

      const provider = this.providers.get(existing.type);
      if (!provider || !provider.validateConfig(mergedConfig)) {
        throw new Error(`Invalid configuration for ${existing.type} channel`);
      }
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (mergedConfig !== undefined) updateData.config = mergedConfig;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.enabled !== undefined) updateData.enabled = input.enabled;

    const channel = await db
      .updateTable('notification_channels')
      .set(updateData)
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapChannel(channel);
  }

  /**
   * Delete a channel
   */
  async deleteChannel(id: string, organizationId: string): Promise<boolean> {
    const result = await db
      .deleteFrom('notification_channels')
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return (result.numDeletedRows ?? 0n) > 0n;
  }

  /**
   * Test a channel by sending a test notification
   */
  async testChannel(id: string, organizationId: string): Promise<DeliveryResult> {
    const channel = await this.getChannel(id, organizationId);
    if (!channel) {
      throw new Error('Channel not found');
    }

    const provider = this.providers.get(channel.type);
    if (!provider) {
      throw new Error(`Provider not found for type: ${channel.type}`);
    }

    return provider.test(channel.config, organizationId);
  }

  /**
   * Test a destination configuration that is not saved yet. With channelId the
   * stored config of that channel (same organization) supplies any secret the
   * caller left blank, so edit-mode tests work. Nothing is persisted.
   */
  async testUnsaved(
    organizationId: string,
    type: NotificationChannelType,
    config: ChannelConfig,
    channelId?: string
  ): Promise<DeliveryResult> {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Unsupported channel type: ${type}`);
    }

    let effective = config;
    if (channelId) {
      const existing = await this.getChannel(channelId, organizationId);
      if (!existing) {
        throw new Error('Channel not found');
      }
      if (existing.type !== type) {
        throw new Error(`Invalid configuration for ${type} channel`);
      }
      effective = mergeConfigSecrets(existing.config, config);
    }

    if (!provider.validateConfig(effective)) {
      throw new Error(`Invalid configuration for ${type} channel`);
    }

    return provider.test(effective, organizationId);
  }

  // ============================================================================
  // CHANNEL ASSOCIATIONS (ALERT RULES)
  // ============================================================================

  /**
   * Set channels for an alert rule (replaces existing)
   */
  async setAlertRuleChannels(
    alertRuleId: string,
    channelIds: string[],
    organizationId: string
  ): Promise<void> {
    if (channelIds.length > 0 && !(await this.channelsBelongToOrg(channelIds, organizationId))) {
      throw new Error('One or more channels do not belong to this organization');
    }
    await db.transaction().execute(async (trx) => {
      // Delete existing associations
      await trx
        .deleteFrom('alert_rule_channels')
        .where('alert_rule_id', '=', alertRuleId)
        .execute();

      // Insert new associations
      if (channelIds.length > 0) {
        await trx
          .insertInto('alert_rule_channels')
          .values(
            channelIds.map((channelId) => ({
              alert_rule_id: alertRuleId,
              channel_id: channelId,
            }))
          )
          .execute();
      }
    });
  }

  /**
   * Get channels for an alert rule
   */
  async getAlertRuleChannels(
    alertRuleId: string,
    organizationId?: string
  ): Promise<NotificationChannel[]> {
    let query = db
      .selectFrom('alert_rule_channels')
      .innerJoin(
        'notification_channels',
        'notification_channels.id',
        'alert_rule_channels.channel_id'
      )
      .selectAll('notification_channels')
      .where('alert_rule_channels.alert_rule_id', '=', alertRuleId)
      .where('notification_channels.enabled', '=', true);

    // Optional org scoping: defense in depth for tenant-facing callers.
    if (organizationId) {
      query = query.where('notification_channels.organization_id', '=', organizationId);
    }

    const rows = await query.execute();

    return rows.map((r) => this.mapChannel(r));
  }

  /** Organization that owns an alert rule, or null if the rule does not exist. */
  async getAlertRuleOrganizationId(alertRuleId: string): Promise<string | null> {
    const row = await db
      .selectFrom('alert_rules')
      .select('organization_id')
      .where('id', '=', alertRuleId)
      .executeTakeFirst();
    return row?.organization_id ?? null;
  }

  // ============================================================================
  // CHANNEL ASSOCIATIONS (SIGMA RULES)
  // ============================================================================

  /**
   * Set channels for a sigma rule (replaces existing)
   */
  async setSigmaRuleChannels(
    sigmaRuleId: string,
    channelIds: string[],
    organizationId: string
  ): Promise<void> {
    if (channelIds.length > 0 && !(await this.channelsBelongToOrg(channelIds, organizationId))) {
      throw new Error('One or more channels do not belong to this organization');
    }
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('sigma_rule_channels')
        .where('sigma_rule_id', '=', sigmaRuleId)
        .execute();

      if (channelIds.length > 0) {
        await trx
          .insertInto('sigma_rule_channels')
          .values(
            channelIds.map((channelId) => ({
              sigma_rule_id: sigmaRuleId,
              channel_id: channelId,
            }))
          )
          .execute();
      }
    });
  }

  /**
   * Get channels for a sigma rule
   */
  async getSigmaRuleChannels(
    sigmaRuleId: string,
    organizationId?: string
  ): Promise<NotificationChannel[]> {
    let query = db
      .selectFrom('sigma_rule_channels')
      .innerJoin(
        'notification_channels',
        'notification_channels.id',
        'sigma_rule_channels.channel_id'
      )
      .selectAll('notification_channels')
      .where('sigma_rule_channels.sigma_rule_id', '=', sigmaRuleId)
      .where('notification_channels.enabled', '=', true);

    // Optional org scoping: defense in depth for tenant-facing callers.
    if (organizationId) {
      query = query.where('notification_channels.organization_id', '=', organizationId);
    }

    const rows = await query.execute();

    return rows.map((r) => this.mapChannel(r));
  }

  /** Organization that owns a sigma rule, or null if the rule does not exist. */
  async getSigmaRuleOrganizationId(sigmaRuleId: string): Promise<string | null> {
    const row = await db
      .selectFrom('sigma_rules')
      .select('organization_id')
      .where('id', '=', sigmaRuleId)
      .executeTakeFirst();
    return row?.organization_id ?? null;
  }

  // ============================================================================
  // CHANNEL ASSOCIATIONS (MONITORS)
  // ============================================================================

  /**
   * Set channels for a monitor (replaces existing)
   */
  async setMonitorChannels(
    monitorId: string,
    channelIds: string[],
    organizationId: string
  ): Promise<void> {
    if (channelIds.length > 0 && !(await this.channelsBelongToOrg(channelIds, organizationId))) {
      throw new Error('One or more channels do not belong to this organization');
    }
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('monitor_channels')
        .where('monitor_id', '=', monitorId)
        .execute();

      if (channelIds.length > 0) {
        await trx
          .insertInto('monitor_channels')
          .values(
            channelIds.map((channelId) => ({
              monitor_id: monitorId,
              channel_id: channelId,
            }))
          )
          .execute();
      }
    });
  }

  /**
   * Get channels for a monitor
   */
  async getMonitorChannels(monitorId: string): Promise<NotificationChannel[]> {
    const rows = await db
      .selectFrom('monitor_channels')
      .innerJoin(
        'notification_channels',
        'notification_channels.id',
        'monitor_channels.channel_id'
      )
      .selectAll('notification_channels')
      .where('monitor_channels.monitor_id', '=', monitorId)
      .where('notification_channels.enabled', '=', true)
      .execute();

    return rows.map((r) => this.mapChannel(r));
  }

  // ============================================================================
  // CHANNEL ASSOCIATIONS (INCIDENTS)
  // ============================================================================

  /**
   * Set channels for an incident (replaces existing)
   */
  async setIncidentChannels(incidentId: string, channelIds: string[]): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('incident_channels')
        .where('incident_id', '=', incidentId)
        .execute();

      if (channelIds.length > 0) {
        await trx
          .insertInto('incident_channels')
          .values(
            channelIds.map((channelId) => ({
              incident_id: incidentId,
              channel_id: channelId,
            }))
          )
          .execute();
      }
    });
  }

  /**
   * Get channels for an incident
   */
  async getIncidentChannels(incidentId: string): Promise<NotificationChannel[]> {
    const rows = await db
      .selectFrom('incident_channels')
      .innerJoin(
        'notification_channels',
        'notification_channels.id',
        'incident_channels.channel_id'
      )
      .selectAll('notification_channels')
      .where('incident_channels.incident_id', '=', incidentId)
      .where('notification_channels.enabled', '=', true)
      .execute();

    return rows.map((r) => this.mapChannel(r));
  }

  // ============================================================================
  // CHANNEL ASSOCIATIONS (ERROR GROUPS)
  // ============================================================================

  /**
   * Set channels for an error group (replaces existing)
   */
  async setErrorGroupChannels(errorGroupId: string, channelIds: string[]): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('error_group_channels')
        .where('error_group_id', '=', errorGroupId)
        .execute();

      if (channelIds.length > 0) {
        await trx
          .insertInto('error_group_channels')
          .values(
            channelIds.map((channelId) => ({
              error_group_id: errorGroupId,
              channel_id: channelId,
            }))
          )
          .execute();
      }
    });
  }

  /**
   * Get channels for an error group
   */
  async getErrorGroupChannels(errorGroupId: string): Promise<NotificationChannel[]> {
    const rows = await db
      .selectFrom('error_group_channels')
      .innerJoin(
        'notification_channels',
        'notification_channels.id',
        'error_group_channels.channel_id'
      )
      .selectAll('notification_channels')
      .where('error_group_channels.error_group_id', '=', errorGroupId)
      .where('notification_channels.enabled', '=', true)
      .execute();

    return rows.map((r) => this.mapChannel(r));
  }

  // ============================================================================
  // ORGANIZATION DEFAULTS
  // ============================================================================

  /**
   * Set default channels for an event type in an organization
   */
  /** True if every channel id belongs to the given organization. */
  async channelsBelongToOrg(channelIds: string[], organizationId: string): Promise<boolean> {
    const unique = [...new Set(channelIds)];
    if (unique.length === 0) return true;
    const rows = await db
      .selectFrom('notification_channels')
      .select('id')
      .where('id', 'in', unique)
      .where('organization_id', '=', organizationId)
      .execute();
    return rows.length === unique.length;
  }

  async setOrganizationDefaults(
    organizationId: string,
    eventType: NotificationEventType,
    channelIds: string[]
  ): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('organization_default_channels')
        .where('organization_id', '=', organizationId)
        .where('event_type', '=', eventType)
        .execute();

      if (channelIds.length > 0) {
        await trx
          .insertInto('organization_default_channels')
          .values(
            channelIds.map((channelId) => ({
              organization_id: organizationId,
              event_type: eventType,
              channel_id: channelId,
            }))
          )
          .execute();
      }
    });
  }

  /**
   * Get default channels for an event type in an organization
   */
  async getOrganizationDefaults(
    organizationId: string,
    eventType: NotificationEventType
  ): Promise<NotificationChannel[]> {
    const rows = await db
      .selectFrom('organization_default_channels')
      .innerJoin(
        'notification_channels',
        'notification_channels.id',
        'organization_default_channels.channel_id'
      )
      .selectAll('notification_channels')
      .where('organization_default_channels.organization_id', '=', organizationId)
      .where('organization_default_channels.event_type', '=', eventType)
      .where('notification_channels.enabled', '=', true)
      .execute();

    return rows.map((r) => this.mapChannel(r));
  }

  /**
   * Get all organization defaults (all event types)
   */
  async getAllOrganizationDefaults(
    organizationId: string
  ): Promise<Record<NotificationEventType, NotificationChannel[]>> {
    const rows = await db
      .selectFrom('organization_default_channels')
      .innerJoin(
        'notification_channels',
        'notification_channels.id',
        'organization_default_channels.channel_id'
      )
      .select([
        'organization_default_channels.event_type',
        'notification_channels.id',
        'notification_channels.organization_id',
        'notification_channels.name',
        'notification_channels.type',
        'notification_channels.enabled',
        'notification_channels.config',
        'notification_channels.description',
        'notification_channels.created_by',
        'notification_channels.created_at',
        'notification_channels.updated_at',
      ])
      .where('organization_default_channels.organization_id', '=', organizationId)
      .where('notification_channels.enabled', '=', true)
      .execute();

    const result: Record<NotificationEventType, NotificationChannel[]> = {
      alert: [],
      sigma: [],
      incident: [],
      error: [],
      monitoring: [],
    };

    for (const row of rows) {
      const eventType = row.event_type as NotificationEventType;
      result[eventType].push(this.mapChannel(row));
    }

    return result;
  }

  // ============================================================================
  // NOTIFICATION DELIVERY
  // ============================================================================

  /**
   * Send notification to multiple channels
   */
  async sendToChannels(
    channelIds: string[],
    organizationId: string,
    context: NotificationContext
  ): Promise<Map<string, DeliveryResult>> {
    const results = new Map<string, DeliveryResult>();

    if (channelIds.length === 0) {
      return results;
    }

    // Fetch all channels
    const channels = await db
      .selectFrom('notification_channels')
      .selectAll()
      .where('id', 'in', channelIds)
      .where('organization_id', '=', organizationId)
      .where('enabled', '=', true)
      .execute();

    // Send to each channel in parallel
    const promises = channels.map(async (channel) => {
      const provider = this.providers.get(channel.type);
      if (!provider) {
        results.set(channel.id, {
          success: false,
          error: `Provider not found: ${channel.type}`,
        });
        return;
      }

      try {
        const result = await provider.send({ ...context, channelId: channel.id }, channel.config as ChannelConfig);
        results.set(channel.id, result);
      } catch (error) {
        results.set(channel.id, {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Send notification to channels associated with an alert rule
   */
  async sendToAlertRuleChannels(
    alertRuleId: string,
    organizationId: string,
    context: NotificationContext
  ): Promise<Map<string, DeliveryResult>> {
    const channels = await this.getAlertRuleChannels(alertRuleId);
    const channelIds = channels.map((c) => c.id);
    return this.sendToChannels(channelIds, organizationId, context);
  }

  /**
   * Send notification to channels associated with a sigma rule
   */
  async sendToSigmaRuleChannels(
    sigmaRuleId: string,
    organizationId: string,
    context: NotificationContext
  ): Promise<Map<string, DeliveryResult>> {
    const channels = await this.getSigmaRuleChannels(sigmaRuleId);
    const channelIds = channels.map((c) => c.id);
    return this.sendToChannels(channelIds, organizationId, context);
  }

  /**
   * Send notification to organization default channels for an event type
   */
  async sendToOrganizationDefaults(
    organizationId: string,
    eventType: NotificationEventType,
    context: NotificationContext
  ): Promise<Map<string, DeliveryResult>> {
    const channels = await this.getOrganizationDefaults(organizationId, eventType);
    const channelIds = channels.map((c) => c.id);
    return this.sendToChannels(channelIds, organizationId, context);
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private mapChannel(row: any): NotificationChannel {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      type: row.type,
      enabled: row.enabled,
      config: row.config,
      description: row.description,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export const notificationChannelsService = new NotificationChannelsService();
