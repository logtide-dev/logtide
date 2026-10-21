import { SigmaDetectionEngine, type LogEntry } from '../../modules/sigma/detection-engine.js';
import { db } from '../../database/connection.js';
import { createQueue } from '../connection.js';
import { SiemService } from '../../modules/siem/service.js';
import { sql } from 'kysely';
import { sigmaExceptionsService } from '../../modules/sigma/exceptions-service.js';
import { partitionMatches } from '../../modules/sigma/exceptions.js';

const siemService = new SiemService(db);

export interface SigmaDetectionData {
  logs: LogEntry[];
  organizationId: string;
  projectId?: string;
}

export interface SigmaDetectionMatch {
  logIndex: number;
  sigmaRuleId: string;
  ruleTitle: string;
  ruleLevel: string;
  matchedAt: Date;
  mitreTactics?: string[];
  mitreTechniques?: string[];
  matchedFields?: Record<string, any>;
}

/**
 * Process Sigma detection job
 * Evaluates a batch of logs against active Sigma rules
 */
export async function processSigmaDetection(job: any) {
  const data: SigmaDetectionData = job.data;

  console.log(
    `[SigmaDetection] Processing ${data.logs.length} logs for org ${data.organizationId}`
  );

  try {
    // Evaluate logs against Sigma rules
    const results = await SigmaDetectionEngine.evaluateBatch(
      data.logs,
      data.organizationId,
      data.projectId
    );

    // Collect all matches
    let allMatches: SigmaDetectionMatch[] = [];

    results.forEach((result, logIndex) => {
      if (result.matched) {
        result.matchedRules.forEach((matchedRule) => {
          // Extract MITRE tactics and techniques from tags
          const mitreTactics = matchedRule.ruleTags
            ?.filter(t => t.startsWith('attack.') && !t.match(/\bt\d{4}/i))
            .map(t => t.replace('attack.', '')) || [];
          const mitreTechniques = matchedRule.ruleTags
            ?.filter(t => t.match(/attack\.t\d{4}/i))
            .map(t => t.replace('attack.', '').toUpperCase()) || [];

          allMatches.push({
            logIndex,
            sigmaRuleId: matchedRule.sigmaRuleId,
            ruleTitle: matchedRule.ruleTitle,
            ruleLevel: matchedRule.ruleLevel,
            matchedAt: matchedRule.matchedAt,
            mitreTactics,
            mitreTechniques,
            matchedFields: matchedRule.matchedFields,
          });
        });
      }
    });

    // Apply per-rule exceptions BEFORE any detection event, incident input or
    // notification exists. Fails toward alerting: if the exceptions cannot be
    // loaded, every match is kept.
    if (allMatches.length > 0) {
      const now = new Date();
      let suppressedHits = new Map<string, number>();
      try {
        const ruleIds = [...new Set(allMatches.map((m) => m.sigmaRuleId))];
        const active = await sigmaExceptionsService.loadActiveForRules(
          data.organizationId,
          ruleIds,
          now
        );
        if (active.size > 0) {
          const { kept, suppressed } = partitionMatches(allMatches, data.logs, active, now);
          allMatches = kept;
          suppressedHits = suppressed;
        }
      } catch (error) {
        console.error('[SigmaDetection] Error applying rule exceptions, keeping all matches:', error);
      }

      if (suppressedHits.size > 0) {
        const total = [...suppressedHits.values()].reduce((a, b) => a + b, 0);
        console.log(`[SigmaDetection] ${total} matches suppressed by rule exceptions`);
        try {
          await sigmaExceptionsService.recordHits(data.organizationId, suppressedHits, now);
        } catch (error) {
          console.error('[SigmaDetection] Error recording exception hits:', error);
        }
      }
    }

    if (allMatches.length === 0) {
      // No detections — log only when DEBUG_SIGMA is enabled to avoid noisy worker output
      if (process.env.DEBUG_SIGMA === 'true') {
        console.log(
          `[SigmaDetection] No matches for ${data.logs.length} logs (org ${data.organizationId})`
        );
      }
      return;
    }

    console.log(
      `[SigmaDetection] Found ${allMatches.length} matches across ${data.logs.length} logs`
    );

    // Create detection_event records for SIEM dashboard
    try {
      for (const match of allMatches) {
        const log = data.logs[match.logIndex] as any;

        // Get the full Sigma rule for additional metadata
        const sigmaRule = await db
          .selectFrom('sigma_rules')
          .select(['id', 'title', 'description', 'level', 'mitre_tactics', 'mitre_techniques', 'category'])
          .where('id', '=', match.sigmaRuleId)
          .where('organization_id', '=', data.organizationId)
          .executeTakeFirst();

        if (!sigmaRule) continue;

        // Create detection event
        await siemService.createDetectionEvent({
          organizationId: data.organizationId,
          projectId: data.projectId || null,
          sigmaRuleId: sigmaRule.id,
          logId: log.id || '', // Log ID from ingestion
          severity: (match.ruleLevel as any) || 'medium',
          ruleTitle: match.ruleTitle,
          ruleDescription: sigmaRule.description,
          mitreTactics: sigmaRule.mitre_tactics || match.mitreTactics || null,
          mitreTechniques: sigmaRule.mitre_techniques || match.mitreTechniques || null,
          service: log.service || 'unknown',
          logLevel: log.level || 'info',
          logMessage: log.message || '',
          traceId: log.trace_id || null,
          matchedFields: match.matchedFields || null,
          category: (sigmaRule.category as any) || 'security',
        });
      }

      console.log(`[SigmaDetection] Created ${allMatches.length} detection_event records`);
    } catch (error) {
      console.error('[SigmaDetection] Error creating detection events:', error);
      // Continue with notifications even if detection event creation fails
    }

    // Remember when each rule last produced a kept match (metadata table only)
    try {
      const firedRuleIds = [...new Set(allMatches.map((m) => m.sigmaRuleId))];
      await db
        .updateTable('sigma_rules')
        .set({ last_fired_at: sql<Date>`now()` })
        .where('organization_id', '=', data.organizationId)
        .where('id', 'in', firedRuleIds)
        .execute();
    } catch (error) {
      console.error('[SigmaDetection] Error updating last_fired_at:', error);
    }

    // Group matches by Sigma rule
    const matchesByRule = new Map<string, SigmaDetectionMatch[]>();

    allMatches.forEach((match) => {
      const existing = matchesByRule.get(match.sigmaRuleId) || [];
      existing.push(match);
      matchesByRule.set(match.sigmaRuleId, existing);
    });

    // Save detection history and trigger notifications
    for (const [sigmaRuleId, matches] of matchesByRule.entries()) {
      const firstMatch = matches[0];

      try {
        // Find the Sigma rule in database
        const sigmaRule = await db
          .selectFrom('sigma_rules')
          .select(['id', 'title', 'level', 'email_recipients', 'webhook_url'])
          .where('id', '=', sigmaRuleId)
          .where('organization_id', '=', data.organizationId)
          .executeTakeFirst();

        if (!sigmaRule) {
          console.warn(`[SigmaDetection] Sigma rule not found: ${sigmaRuleId}`);
          continue;
        }

        // Log detection for monitoring
        console.log(
          `[SigmaDetection] Sigma rule matched: ${firstMatch.ruleTitle} (${matches.length} matches, level: ${firstMatch.ruleLevel})`
        );

        // Check if notifications are configured
        const hasEmail = sigmaRule.email_recipients && sigmaRule.email_recipients.length > 0;
        const hasWebhook = !!sigmaRule.webhook_url;

        if (!hasEmail && !hasWebhook) {
          console.log(
            `[SigmaDetection] Sigma rule "${firstMatch.ruleTitle}" matched but has no notification settings (detection-only mode)`
          );
          continue;
        }

        // Queue notification job directly (no alert rule needed)
        const notificationQueue = createQueue('alert-notifications');

        await notificationQueue.add('send-notification', {
          historyId: null, // No alert history for Sigma rules
          rule_id: sigmaRule.id,
          rule_name: `[Sigma] ${firstMatch.ruleTitle}`,
          organization_id: data.organizationId,
          project_id: data.projectId || null,
          log_count: matches.length,
          threshold: 1, // Sigma rules are match-based, not threshold-based
          time_window: 1, // Immediate detection
          email_recipients: sigmaRule.email_recipients || [],
          webhook_url: sigmaRule.webhook_url,
        });

        console.log(
          `[SigmaDetection] Queued notification for: ${firstMatch.ruleTitle}`
        );
      } catch (error) {
        console.error(
          `[SigmaDetection] Error saving detection for rule ${sigmaRuleId}:`,
          error
        );
      }
    }

    console.log(`[SigmaDetection] Job completed successfully`);
  } catch (error) {
    console.error(`[SigmaDetection] Job failed:`, error);
    throw error;
  }
}
