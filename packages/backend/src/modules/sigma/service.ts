import { db } from '../../database/connection.js';
import { SigmaParser } from './parser.js';
import { SigmaConverter } from './converter.js';
import type { SigmaRuleRecord, ParsedSigmaRule } from './types.js';

export interface ImportSigmaRuleInput {
  yaml: string;
  organizationId: string;
  projectId?: string;
  emailRecipients?: string[];
  webhookUrl?: string;
  createAlertRule?: boolean; // If false, only save Sigma rule without creating Alert Rule
}

export interface ImportSigmaRuleResult {
  sigmaRule: SigmaRuleRecord;
  alertRule: any | null; // Raw database row from alert_rules table
  warnings: string[];
  errors: string[];
}

export class SigmaService {
  /**
   * Import a Sigma rule from YAML
   */
  async importSigmaRule(input: ImportSigmaRuleInput): Promise<ImportSigmaRuleResult> {
    // Step 1: Parse Sigma YAML
    const parseResult = SigmaParser.parse(input.yaml);

    if (!parseResult.rule) {
      return {
        sigmaRule: null as any,
        alertRule: null,
        warnings: [],
        errors: parseResult.errors,
      };
    }

    const sigmaRule = parseResult.rule;

    // Step 2: Generate conversion notes (for display purposes)
    const conversionResult = SigmaConverter.convert(sigmaRule, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      emailRecipients: input.emailRecipients,
      webhookUrl: input.webhookUrl,
    });

    // Step 3: Save Sigma Rule with notification settings
    // Sigma rules are now independent - they don't need alert rules
    const sigmaRecord = await this.saveSigmaRule(
      sigmaRule,
      input.organizationId,
      input.projectId,
      input.emailRecipients || [],
      input.webhookUrl || null,
      null, // No alert_rule_id
      'success',
      conversionResult.conversionNotes
    );

    return {
      sigmaRule: sigmaRecord,
      alertRule: null, // We no longer create alert rules for Sigma rules
      warnings: conversionResult.warnings,
      errors: [],
    };
  }

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
   * Save Sigma rule to database
   */
  private async saveSigmaRule(
    rule: ParsedSigmaRule,
    organizationId: string,
    projectId: string | undefined,
    emailRecipients: string[],
    webhookUrl: string | null,
    alertRuleId: string | null,
    conversionStatus: 'success' | 'partial' | 'failed',
    conversionNotes: string
  ): Promise<SigmaRuleRecord> {
    // Extract MITRE tags
    const mitre = this.extractMitreTags(rule.tags);

    const record = await db
      .insertInto('sigma_rules')
      .values({
        organization_id: organizationId,
        project_id: projectId || null,
        sigma_id: rule.id,
        title: rule.title,
        description: rule.description || null,
        author: rule.author || null,
        date: rule.date ? new Date(rule.date) : null,
        level: rule.level,
        status: rule.status,
        logsource: rule.logsource as any,
        detection: rule.detection as any,
        email_recipients: emailRecipients,
        webhook_url: webhookUrl,
        alert_rule_id: alertRuleId,
        conversion_status: conversionStatus,
        conversion_notes: conversionNotes,
        tags: rule.tags || null,
        mitre_tactics: mitre.tactics.length > 0 ? mitre.tactics : null,
        mitre_techniques: mitre.techniques.length > 0 ? mitre.techniques : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Transform snake_case to camelCase for API response
    return {
      id: record.id,
      organizationId: record.organization_id,
      projectId: record.project_id,
      sigmaId: record.sigma_id,
      title: record.title,
      description: record.description,
      author: record.author,
      date: record.date,
      level: record.level,
      status: record.status,
      logsource: record.logsource,
      detection: record.detection,
      emailRecipients: record.email_recipients,
      webhookUrl: record.webhook_url,
      alertRuleId: record.alert_rule_id,
      conversionStatus: record.conversion_status,
      conversionNotes: record.conversion_notes,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    } as unknown as SigmaRuleRecord;
  }

  /**
   * Get Sigma rules for an organization
   */
  async getSigmaRules(organizationId: string): Promise<SigmaRuleRecord[]> {
    const rules = await db
      .selectFrom('sigma_rules')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .orderBy('created_at', 'desc')
      .execute();

    // Transform snake_case to camelCase for API response
    return rules.map((record) => ({
      id: record.id,
      organizationId: record.organization_id,
      projectId: record.project_id,
      sigmaId: record.sigma_id,
      title: record.title,
      description: record.description,
      author: record.author,
      date: record.date,
      level: record.level,
      status: record.status,
      logsource: record.logsource,
      detection: record.detection,
      emailRecipients: record.email_recipients,
      webhookUrl: record.webhook_url,
      alertRuleId: record.alert_rule_id,
      conversionStatus: record.conversion_status,
      conversionNotes: record.conversion_notes,
      enabled: record.enabled,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    })) as unknown as SigmaRuleRecord[];
  }

  /**
   * Get Sigma rule by ID
   */
  async getSigmaRuleById(
    id: string,
    organizationId: string
  ): Promise<SigmaRuleRecord | null> {
    const record = await db
      .selectFrom('sigma_rules')
      .selectAll()
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!record) {
      return null;
    }

    // Transform snake_case to camelCase for API response
    return {
      id: record.id,
      organizationId: record.organization_id,
      projectId: record.project_id,
      sigmaId: record.sigma_id,
      title: record.title,
      description: record.description,
      author: record.author,
      date: record.date,
      level: record.level,
      status: record.status,
      logsource: record.logsource,
      detection: record.detection,
      emailRecipients: record.email_recipients,
      webhookUrl: record.webhook_url,
      alertRuleId: record.alert_rule_id,
      conversionStatus: record.conversion_status,
      conversionNotes: record.conversion_notes,
      enabled: record.enabled,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    } as unknown as SigmaRuleRecord;
  }

  /**
   * Toggle enabled status for a Sigma rule
   */
  async toggleSigmaRule(
    id: string,
    organizationId: string,
    enabled: boolean
  ): Promise<SigmaRuleRecord | null> {
    const record = await db
      .updateTable('sigma_rules')
      .set({ enabled, updated_at: new Date() })
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .returningAll()
      .executeTakeFirst();

    if (!record) {
      return null;
    }

    return {
      id: record.id,
      organizationId: record.organization_id,
      projectId: record.project_id,
      sigmaId: record.sigma_id,
      title: record.title,
      description: record.description,
      author: record.author,
      date: record.date,
      level: record.level,
      status: record.status,
      logsource: record.logsource,
      detection: record.detection,
      emailRecipients: record.email_recipients,
      webhookUrl: record.webhook_url,
      alertRuleId: record.alert_rule_id,
      conversionStatus: record.conversion_status,
      conversionNotes: record.conversion_notes,
      enabled: record.enabled,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    } as unknown as SigmaRuleRecord;
  }

  /**
   * Delete Sigma rule (and optionally its associated alert rule)
   */
  async deleteSigmaRule(
    id: string,
    organizationId: string,
    deleteAlertRule: boolean = false
  ): Promise<void> {
    const rule = await this.getSigmaRuleById(id, organizationId);

    if (!rule) {
      throw new Error('Sigma rule not found');
    }

    // Delete associated alert rule if requested
    if (deleteAlertRule && rule.alertRuleId) {
      await db
        .deleteFrom('alert_rules')
        .where('id', '=', rule.alertRuleId)
        .execute();
    }

    // Delete Sigma rule
    await db
      .deleteFrom('sigma_rules')
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .execute();
  }
}
