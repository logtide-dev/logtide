/**
 * Sigma Sync Service
 *
 * Orchestrates importing Sigma rules from SigmaHQ repository
 */

import { sigmahqClient, type SigmaRuleFile } from './github-client.js';
import { SigmaParser } from './parser.js';
import { SigmaConverter } from './converter.js';
import { MITREMapper } from './mitre-mapper.js';
import { db } from '../../database/connection.js';
import { sql } from 'kysely';

export interface SyncOptions {
  organizationId: string;
  projectId?: string;
  category?: string; // Legacy: single category (deprecated)
  selection?: {
    // New: granular selection
    categories?: string[]; // Array of category paths
    rules?: string[]; // Array of individual rule paths
  };
  limit?: number; // Max rules to import
  autoCreateAlerts?: boolean; // Create alert rules automatically
  emailRecipients?: string[];
  webhookUrl?: string;
  onProgress?: (current: number, total: number, ruleName: string) => void;
}

export interface SyncResult {
  success: boolean;
  imported: number;
  failed: number;
  skipped: number;
  errors: Array<{ rule: string; error: string }>;
  warnings: string[];
  commitHash: string;
}

export interface SyncStatus {
  organizationId: string;
  lastSyncedAt: Date | null;
  totalRules: number;
  syncedRules: number;
  failedRules: number;
  nextScheduledSync: Date | null;
}

export class SigmaSyncService {
  /**
   * Sync rules from SigmaHQ repository
   */
  async syncFromSigmaHQ(options: SyncOptions): Promise<SyncResult> {
    const {
      organizationId,
      projectId,
      category,
      selection,
      limit,
      autoCreateAlerts = true,
      emailRecipients = [],
      webhookUrl,
      onProgress,
    } = options;

    console.log(`[SigmaSync] Starting sync for organization ${organizationId}`);
    console.log(`[SigmaSync] Category: ${category || 'N/A'}, Selection: ${selection ? JSON.stringify(selection) : 'N/A'}, Limit: ${limit || 'NONE'}`);

    const result: SyncResult = {
      success: true,
      imported: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      warnings: [],
      commitHash: '',
    };

    try {
      // Get latest commit hash for versioning
      result.commitHash = await sigmahqClient.getLatestCommit();
      console.log(`[SigmaSync] Latest commit: ${result.commitHash}`);

      // Fetch rules from SigmaHQ
      let ruleFiles: SigmaRuleFile[] = [];

      // New: Granular selection (categories + individual rules)
      if (selection && (selection.categories?.length || selection.rules?.length)) {
        console.log(`[SigmaSync] Using granular selection`);

        // 1. Fetch all rules from selected categories
        if (selection.categories && selection.categories.length > 0) {
          console.log(`[SigmaSync] Fetching ${selection.categories.length} categories`);
          for (const cat of selection.categories) {
            const catRules = await sigmahqClient.fetchRulesByCategory(cat);
            console.log(`[SigmaSync] Category ${cat}: ${catRules.length} rules`);
            ruleFiles.push(...catRules);
          }
        }

        // 2. Fetch individual rules
        if (selection.rules && selection.rules.length > 0) {
          console.log(`[SigmaSync] Adding ${selection.rules.length} individual rules`);
          for (const rulePath of selection.rules) {
            // Create SigmaRuleFile object from path
            const fileName = rulePath.split('/').pop() || rulePath;
            const relativePath = rulePath.replace(/^rules\//, '');
            const categoryName = relativePath.split('/').slice(0, -1).join('/');

            ruleFiles.push({
              path: rulePath,
              name: fileName,
              category: categoryName,
              downloadUrl: `https://raw.githubusercontent.com/SigmaHQ/sigma/master/${rulePath}`,
              sha: '', // Will be fetched on download
            });
          }
        }

        // Remove duplicates (same path)
        const uniquePaths = new Set<string>();
        ruleFiles = ruleFiles.filter((rule) => {
          if (uniquePaths.has(rule.path)) {
            return false;
          }
          uniquePaths.add(rule.path);
          return true;
        });
      } else if (category) {
        // Legacy: Single category
        console.log(`[SigmaSync] Fetching rules from category: ${category}`);
        ruleFiles = await sigmahqClient.fetchRulesByCategory(category);
      } else {
        // Fetch ALL rules
        console.log(`[SigmaSync] Fetching ALL rules (this may take a while)...`);
        ruleFiles = await sigmahqClient.fetchAllRules();
      }

      // Apply limit if specified
      if (limit && limit > 0) {
        ruleFiles = ruleFiles.slice(0, limit);
      }

      console.log(`[SigmaSync] Found ${ruleFiles.length} rules to process`);

      // Process each rule
      for (let i = 0; i < ruleFiles.length; i++) {
        const ruleFile = ruleFiles[i];

        if (onProgress) {
          onProgress(i + 1, ruleFiles.length, ruleFile.name);
        }

        try {
          // Check if rule already exists (by sigmahq_path)
          const existing = await db
            .selectFrom('sigma_rules')
            .select(['id', 'sigmahq_commit'])
            .where('organization_id', '=', organizationId)
            .where('sigmahq_path', '=', ruleFile.path)
            .executeTakeFirst();

          // Skip if already imported with same commit
          if (existing && existing.sigmahq_commit === result.commitHash) {
            console.log(`[SigmaSync] Skipping (already synced): ${ruleFile.name}`);
            result.skipped++;
            continue;
          }

          // Fetch YAML content
          const yamlContent = await sigmahqClient.fetchRule(ruleFile.downloadUrl);

          // Parse Sigma rule
          const parseResult = SigmaParser.parse(yamlContent);

          if (!parseResult.rule) {
            result.failed++;
            result.errors.push({
              rule: ruleFile.name,
              error: parseResult.errors.join(', ') || 'Failed to parse YAML',
            });
            continue;
          }

          const sigmaRule = parseResult.rule;

          // Extract MITRE data from tags
          const mitre = MITREMapper.parseFromTags(sigmaRule.tags || []);

          // Convert to LogTide Alert Rule (if enabled)
          // Note: We ALWAYS create Alert Rules (even for complex rules) to store
          // notification settings (email, webhook). The Detection Engine handles
          // all Sigma features, so no need to distinguish simple vs complex.
          let alertRuleId: string | undefined;
          let conversionStatus: 'success' | 'partial' | 'failed' = 'success';
          let conversionNotes = '';

          if (autoCreateAlerts) {
            const conversion = SigmaConverter.convert(sigmaRule, {
              organizationId,
              projectId,
              emailRecipients,
              webhookUrl,
            });

            conversionStatus = conversion.success ? 'success' : 'failed';
            conversionNotes = conversion.conversionNotes;

            if (conversion.warnings.length > 0) {
              conversionStatus = 'partial';
              result.warnings.push(...conversion.warnings);
            }

            // Create alert rule if conversion succeeded
            if (conversion.success && conversion.alertRule) {
              const alertResult = await db
                .insertInto('alert_rules')
                .values({
                  organization_id: organizationId,
                  project_id: projectId || null,
                  name: conversion.alertRule.name,
                  enabled: conversion.alertRule.enabled,
                  service: conversion.alertRule.service || null,
                  level: conversion.alertRule.level as ('debug' | 'info' | 'warn' | 'error' | 'critical')[],
                  threshold: conversion.alertRule.threshold,
                  time_window: conversion.alertRule.timeWindow,
                  email_recipients: conversion.alertRule.emailRecipients,
                  webhook_url: conversion.alertRule.webhookUrl || null,
                  metadata: conversion.alertRule.metadata || null,
                })
                .returning(['id'])
                .executeTakeFirst();

              alertRuleId = alertResult?.id;
            }
          }

          // Update existing or insert new sigma_rule
          if (existing) {
            await db
              .updateTable('sigma_rules')
              .set({
                title: sigmaRule.title,
                description: sigmaRule.description || null,
                author: sigmaRule.author || null,
                date: sigmaRule.date ? new Date(sigmaRule.date) : null,
                level: sigmaRule.level || null,
                status: sigmaRule.status || null,
                logsource: JSON.parse(JSON.stringify(sigmaRule.logsource)),
                detection: JSON.parse(JSON.stringify(sigmaRule.detection)),
                email_recipients: emailRecipients,
                webhook_url: webhookUrl || null,
                tags: sigmaRule.tags || null,
                mitre_tactics: mitre.tactics.length > 0 ? mitre.tactics : null,
                mitre_techniques: mitre.techniques.length > 0 ? mitre.techniques : null,
                sigmahq_path: ruleFile.path,
                sigmahq_commit: result.commitHash,
                last_synced_at: new Date(),
                conversion_status: conversionStatus,
                conversion_notes: conversionNotes || null,
                alert_rule_id: alertRuleId || existing.id,
                updated_at: new Date(),
              })
              .where('id', '=', existing.id)
              .execute();

            console.log(`[SigmaSync] Updated: ${ruleFile.name}`);
          } else {
            await db
              .insertInto('sigma_rules')
              .values({
                organization_id: organizationId,
                project_id: projectId || null,
                sigma_id: sigmaRule.id || null,
                title: sigmaRule.title,
                description: sigmaRule.description || null,
                author: sigmaRule.author || null,
                date: sigmaRule.date ? new Date(sigmaRule.date) : null,
                level: sigmaRule.level || null,
                status: sigmaRule.status || null,
                logsource: JSON.parse(JSON.stringify(sigmaRule.logsource)),
                detection: JSON.parse(JSON.stringify(sigmaRule.detection)),
                email_recipients: emailRecipients,
                webhook_url: webhookUrl || null,
                tags: sigmaRule.tags || null,
                mitre_tactics: mitre.tactics.length > 0 ? mitre.tactics : null,
                mitre_techniques: mitre.techniques.length > 0 ? mitre.techniques : null,
                sigmahq_path: ruleFile.path,
                sigmahq_commit: result.commitHash,
                last_synced_at: new Date(),
                conversion_status: conversionStatus,
                conversion_notes: conversionNotes || null,
                alert_rule_id: alertRuleId || null,
              })
              .execute();

            console.log(`[SigmaSync] Imported: ${ruleFile.name}`);
          }

          result.imported++;
        } catch (error) {
          console.error(`[SigmaSync] Error processing ${ruleFile.name}:`, error);
          result.failed++;
          result.errors.push({
            rule: ruleFile.name,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      console.log(`[SigmaSync] Sync completed: ${result.imported} imported, ${result.failed} failed, ${result.skipped} skipped`);

      return result;
    } catch (error) {
      console.error('[SigmaSync] Sync failed:', error);
      result.success = false;
      result.errors.push({
        rule: 'SYNC_PROCESS',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return result;
    }
  }

  /**
   * Get available categories from SigmaHQ
   */
  async getCategories() {
    return await sigmahqClient.getCategories();
  }

  /**
   * Get sync status for an organization
   */
  async getSyncStatus(organizationId: string): Promise<SyncStatus> {
    const stats = await db
      .selectFrom('sigma_rules')
      .select([
        db.fn.count('id').as('total_rules'),
        db.fn.max('last_synced_at').as('last_synced_at'),
      ])
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    const failedCount = await db
      .selectFrom('sigma_rules')
      .select(db.fn.count('id').as('count'))
      .where('organization_id', '=', organizationId)
      .where('conversion_status', '=', 'failed')
      .executeTakeFirst();

    // Calculate next scheduled sync (daily at 2:00 AM)
    const nextSync = this.calculateNextSyncTime();

    return {
      organizationId,
      lastSyncedAt: stats?.last_synced_at ? new Date(stats.last_synced_at) : null,
      totalRules: Number(stats?.total_rules || 0),
      syncedRules: Number(stats?.total_rules || 0) - Number(failedCount?.count || 0),
      failedRules: Number(failedCount?.count || 0),
      nextScheduledSync: nextSync,
    };
  }

  /**
   * Search Sigma rules by MITRE technique
   */
  async searchByMITRETechnique(
    organizationId: string,
    techniqueId: string
  ) {
    const rules = await db
      .selectFrom('sigma_rules')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where(sql<boolean>`mitre_techniques @> ${sql.literal(JSON.stringify([techniqueId]))}::jsonb`)
      .execute();

    return rules;
  }

  /**
   * Search Sigma rules by MITRE tactic
   */
  async searchByMITRETactic(
    organizationId: string,
    tacticName: string
  ) {
    const rules = await db
      .selectFrom('sigma_rules')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where(sql<boolean>`mitre_tactics @> ${sql.literal(JSON.stringify([tacticName]))}::jsonb`)
      .execute();

    return rules;
  }

  /**
   * Search Sigma rules by tag
   */
  async searchByTag(organizationId: string, tag: string) {
    const rules = await db
      .selectFrom('sigma_rules')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where(sql<boolean>`tags @> ${sql.literal(JSON.stringify([tag]))}::jsonb`)
      .execute();

    return rules;
  }

  /**
   * Calculate next scheduled sync time
   * Default: Daily at 2:00 AM local time
   * For production: store schedule config in database
   */
  private calculateNextSyncTime(): Date {
    const now = new Date();
    const next = new Date(now);

    // Set to 2:00 AM
    next.setHours(2, 0, 0, 0);

    // If 2:00 AM has already passed today, schedule for tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  }
}

export const sigmaSyncService = new SigmaSyncService();
