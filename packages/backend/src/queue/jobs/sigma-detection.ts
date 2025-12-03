import { SigmaDetectionEngine, type LogEntry } from '../../modules/sigma/detection-engine.js';
import { db } from '../../database/connection.js';
import { createQueue } from '../connection.js';
import { SiemService } from '../../modules/siem/service.js';

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
    const allMatches: SigmaDetectionMatch[] = [];

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
          });
        });
      }
    });

    if (allMatches.length === 0) {
      console.log(`[SigmaDetection] No matches found`);
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
          .select(['id', 'title', 'description', 'level', 'mitre_tactics', 'mitre_techniques'])
          .where('sigma_id', '=', match.sigmaRuleId)
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
          matchedFields: null, // TODO: Capture matched fields from detection engine
        });
      }

      console.log(`[SigmaDetection] Created ${allMatches.length} detection_event records`);
    } catch (error) {
      console.error('[SigmaDetection] Error creating detection events:', error);
      // Continue with notifications even if detection event creation fails
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
          .where('sigma_id', '=', sigmaRuleId)
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
