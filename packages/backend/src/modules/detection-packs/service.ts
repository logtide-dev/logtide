import { db } from '../../database/connection.js';
import { DETECTION_PACKS, getPackById } from './pack-definitions.js';
import type {
  DetectionPackWithStatus,
  PackActivation,
  ThresholdMap,
} from './types.js';

export class DetectionPacksService {
  /**
   * Extract MITRE ATT&CK tactics and techniques from tags
   */
  private extractMitreTags(tags: string[] | undefined): {
    tactics: string[];
    techniques: string[];
  } {
    if (!tags || tags.length === 0) {
      return { tactics: [], techniques: [] };
    }

    const tactics: string[] = [];
    const techniques: string[] = [];

    for (const tag of tags) {
      const lowerTag = tag.toLowerCase();
      // MITRE technique pattern: attack.t1234 or attack.t1234.001
      if (/^attack\.t\d{4}(\.\d{3})?$/i.test(lowerTag)) {
        techniques.push(tag.replace('attack.', '').toUpperCase());
      }
      // MITRE tactic pattern: attack.tactic_name (not a technique)
      else if (lowerTag.startsWith('attack.') && !lowerTag.match(/^attack\.t\d/)) {
        tactics.push(tag.replace('attack.', ''));
      }
    }

    return { tactics, techniques };
  }

  /**
   * Get all available packs with their activation status for an organization
   */
  async listPacksWithStatus(organizationId: string): Promise<DetectionPackWithStatus[]> {
    // Get all activations for this org
    const activations = await db
      .selectFrom('detection_pack_activations')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .execute();

    const activationMap = new Map(
      activations.map((a) => [a.pack_id, a])
    );

    // Get count of generated sigma rules per pack
    // Sigma rules from packs have sigma_id starting with 'pack-'
    const sigmaRules = await db
      .selectFrom('sigma_rules')
      .select(['sigma_id'])
      .where('organization_id', '=', organizationId)
      .where('sigma_id', 'like', 'pack-%')
      .execute();

    const ruleCountByPack = new Map<string, number>();
    for (const rule of sigmaRules) {
      // sigma_id format: pack-{packId}-{ruleId}
      const parts = rule.sigma_id?.split('-');
      if (parts && parts.length >= 2) {
        const packId = parts[1];
        ruleCountByPack.set(packId, (ruleCountByPack.get(packId) || 0) + 1);
      }
    }

    return DETECTION_PACKS.map((pack): DetectionPackWithStatus => {
      const activation = activationMap.get(pack.id);
      return {
        ...pack,
        enabled: activation?.enabled ?? false,
        activatedAt: activation?.activated_at ? new Date(activation.activated_at).toISOString() : null,
        customThresholds: (activation?.custom_thresholds as ThresholdMap | null) ?? null,
        generatedRulesCount: ruleCountByPack.get(pack.id) || 0,
      };
    });
  }

  /**
   * Get a single pack with status
   */
  async getPackWithStatus(
    organizationId: string,
    packId: string
  ): Promise<DetectionPackWithStatus | null> {
    const pack = getPackById(packId);
    if (!pack) return null;

    const activation = await db
      .selectFrom('detection_pack_activations')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('pack_id', '=', packId)
      .executeTakeFirst();

    // Count generated sigma rules for this pack
    const result = await db
      .selectFrom('sigma_rules')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('organization_id', '=', organizationId)
      .where('sigma_id', 'like', `pack-${packId}-%`)
      .executeTakeFirst();

    return {
      ...pack,
      enabled: activation?.enabled ?? false,
      activatedAt: activation?.activated_at ? new Date(activation.activated_at).toISOString() : null,
      customThresholds: (activation?.custom_thresholds as ThresholdMap | null) ?? null,
      generatedRulesCount: Number(result?.count || 0),
    };
  }

  /**
   * Enable a pack for an organization
   * Creates Sigma rules from pack definition for SIEM integration
   */
  async enablePack(
    organizationId: string,
    packId: string,
    customThresholds?: ThresholdMap,
    emailRecipients?: string[],
    webhookUrl?: string | null
  ): Promise<void> {
    const pack = getPackById(packId);
    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    // Check if already enabled
    const existing = await db
      .selectFrom('detection_pack_activations')
      .select(['id', 'enabled'])
      .where('organization_id', '=', organizationId)
      .where('pack_id', '=', packId)
      .executeTakeFirst();

    if (existing?.enabled) {
      throw new Error(`Pack already enabled: ${packId}`);
    }

    // Default email to empty array if not provided (user can add later)
    const recipients = emailRecipients ?? [];

    // Start transaction
    await db.transaction().execute(async (trx) => {
      // Upsert activation record
      if (existing) {
        await trx
          .updateTable('detection_pack_activations')
          .set({
            enabled: true,
            custom_thresholds: customThresholds ?? null,
            updated_at: new Date(),
          })
          .where('id', '=', existing.id)
          .execute();
      } else {
        await trx
          .insertInto('detection_pack_activations')
          .values({
            organization_id: organizationId,
            pack_id: packId,
            enabled: true,
            custom_thresholds: customThresholds ?? null,
          })
          .execute();
      }

      // Create Sigma rules for each rule in the pack
      for (const rule of pack.rules) {
        const override = customThresholds?.[rule.id];
        const level = override?.level ?? rule.level;
        const mitre = this.extractMitreTags(rule.tags);

        await trx
          .insertInto('sigma_rules')
          .values({
            organization_id: organizationId,
            project_id: null, // Pack rules are org-wide
            sigma_id: `pack-${packId}-${rule.id}`,
            title: `[${pack.name}] ${rule.name}`,
            description: rule.description,
            author: pack.author ?? 'LogTide',
            date: new Date(),
            level,
            status: rule.status,
            logsource: rule.logsource as any,
            detection: rule.detection as any,
            email_recipients: recipients,
            webhook_url: webhookUrl ?? null,
            alert_rule_id: null,
            conversion_status: 'success',
            conversion_notes: `Generated from Detection Pack: ${pack.name}`,
            enabled: true,
            tags: rule.tags ?? null,
            mitre_tactics: mitre.tactics.length > 0 ? mitre.tactics : null,
            mitre_techniques: mitre.techniques.length > 0 ? mitre.techniques : null,
          })
          .execute();
      }
    });
  }

  /**
   * Disable a pack for an organization
   * Deletes all generated Sigma rules
   */
  async disablePack(organizationId: string, packId: string): Promise<void> {
    const pack = getPackById(packId);
    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    // Check if pack is actually enabled
    const existing = await db
      .selectFrom('detection_pack_activations')
      .select(['id', 'enabled'])
      .where('organization_id', '=', organizationId)
      .where('pack_id', '=', packId)
      .executeTakeFirst();

    if (!existing || !existing.enabled) {
      throw new Error(`Pack is not enabled: ${packId}`);
    }

    await db.transaction().execute(async (trx) => {
      // Update activation record
      await trx
        .updateTable('detection_pack_activations')
        .set({
          enabled: false,
          updated_at: new Date(),
        })
        .where('organization_id', '=', organizationId)
        .where('pack_id', '=', packId)
        .execute();

      // Delete all Sigma rules for this pack (identified by sigma_id prefix)
      await trx
        .deleteFrom('sigma_rules')
        .where('organization_id', '=', organizationId)
        .where('sigma_id', 'like', `pack-${packId}-%`)
        .execute();
    });
  }

  /**
   * Update thresholds/settings for an enabled pack
   */
  async updatePackThresholds(
    organizationId: string,
    packId: string,
    customThresholds: ThresholdMap
  ): Promise<void> {
    const pack = getPackById(packId);
    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    await db.transaction().execute(async (trx) => {
      // Update activation record with new thresholds
      await trx
        .updateTable('detection_pack_activations')
        .set({
          custom_thresholds: customThresholds,
          updated_at: new Date(),
        })
        .where('organization_id', '=', organizationId)
        .where('pack_id', '=', packId)
        .execute();

      // Update each Sigma rule with new level if specified
      for (const rule of pack.rules) {
        const override = customThresholds[rule.id];
        if (!override) continue;

        const updates: Record<string, unknown> = { updated_at: new Date() };
        if (override.level !== undefined) updates.level = override.level;
        if (override.emailEnabled !== undefined) {
          // Enable/disable email by clearing or keeping recipients
          // (Note: this is a simplified approach, actual recipients come from enablePack)
        }

        if (Object.keys(updates).length > 1) { // More than just updated_at
          await trx
            .updateTable('sigma_rules')
            .set(updates)
            .where('organization_id', '=', organizationId)
            .where('sigma_id', '=', `pack-${packId}-${rule.id}`)
            .execute();
        }
      }
    });
  }

  /**
   * Get activation record
   */
  async getActivation(
    organizationId: string,
    packId: string
  ): Promise<PackActivation | null> {
    const row = await db
      .selectFrom('detection_pack_activations')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('pack_id', '=', packId)
      .executeTakeFirst();

    if (!row) return null;

    return {
      id: row.id,
      organizationId: row.organization_id,
      packId: row.pack_id,
      enabled: row.enabled,
      customThresholds: (row.custom_thresholds as ThresholdMap | null) ?? null,
      activatedAt: new Date(row.activated_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export const detectionPacksService = new DetectionPacksService();
