import { db } from '../../database/connection.js';
import { SigmaConditionEvaluator } from './condition-evaluator.js';
import type { ParsedSigmaRule } from './types.js';

/**
 * SigmaDetectionEngine - Orchestrate Sigma rule evaluation on log data
 *
 * Workflow:
 * 1. Load active Sigma rules from database
 * 2. Filter rules by logsource matching
 * 3. Evaluate detection logic for each rule
 * 4. Return matched rules
 */

export interface DetectionResult {
  matched: boolean;
  matchedRules: MatchedRule[];
}

export interface MatchedRule {
  sigmaRuleId: string;
  ruleTitle: string;
  ruleLevel: string;
  ruleTags?: string[];
  matchedAt: Date;
  matchedFields?: Record<string, any>; // Fields that triggered the match
}

export interface LogEntry {
  service?: string;
  level?: string;
  message: string;
  metadata?: Record<string, any>;
  [key: string]: any;
}

export class SigmaDetectionEngine {
  /**
   * Evaluate a single log entry against all active Sigma rules
   */
  static async evaluateLog(
    logEntry: LogEntry,
    organizationId: string,
    projectId?: string
  ): Promise<DetectionResult> {
    // Step 1: Load active Sigma rules for this organization/project
    const rules = await this.loadActiveRules(organizationId, projectId);

    if (rules.length === 0) {
      return { matched: false, matchedRules: [] };
    }

    // Step 2: Flatten log entry for field matching
    const flattenedLog = this.flattenLogEntry(logEntry);

    // Step 3: Evaluate each rule
    const matchedRules: MatchedRule[] = [];

    for (const rule of rules) {
      try {
        const logsourceMatched = this.matchLogsource(rule.logsource, logEntry);
        if (!logsourceMatched) {
          continue;
        }

        const matched = SigmaConditionEvaluator.evaluateDetection(
          rule.detection,
          flattenedLog,
          false
        );

        if (matched) {
          // Extract matched fields from detection patterns
          const matchedFields = this.extractMatchedFields(rule.detection, flattenedLog);

          matchedRules.push({
            sigmaRuleId: rule.id,
            ruleTitle: rule.title,
            ruleLevel: rule.level || 'medium',
            ruleTags: rule.tags,
            matchedAt: new Date(),
            matchedFields,
          });
        }
      } catch (error) {
        // Log evaluation error but continue with other rules
        console.error(
          `[SigmaDetectionEngine] Error evaluating rule ${rule.id} (${rule.title}):`,
          error
        );
      }
    }

    return {
      matched: matchedRules.length > 0,
      matchedRules,
    };
  }

  /**
   * Load active Sigma rules from database
   */
  private static async loadActiveRules(
    organizationId: string,
    projectId?: string
  ): Promise<ParsedSigmaRule[]> {
    let query = db
      .selectFrom('sigma_rules')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('conversion_status', 'in', ['success', 'partial'])
      .where('enabled', '=', true);

    // Filter by project if specified
    if (projectId) {
      query = query.where((eb) =>
        eb.or([
          eb('project_id', '=', projectId),
          eb('project_id', 'is', null), // Include org-wide rules
        ])
      );
    }

    const rules = await query.execute();

    return rules.map((rule) => ({
      id: rule.sigma_id || rule.id,
      title: rule.title,
      description: rule.description || undefined,
      level: (rule.level || 'medium') as 'informational' | 'low' | 'medium' | 'high' | 'critical',
      status: (rule.status || 'stable') as 'experimental' | 'test' | 'stable' | 'deprecated' | 'unsupported',
      logsource: rule.logsource as any,
      detection: rule.detection as any,
      tags: (rule as any).tags || undefined,
    }));
  }

  /**
   * Match logsource against log entry
   */
  private static matchLogsource(
    logsource: Record<string, any>,
    logEntry: LogEntry
  ): boolean {
    // If no logsource specified, match all logs
    if (!logsource || Object.keys(logsource).length === 0) {
      return true;
    }

    // Match service field
    if (logsource.service) {
      const servicePattern = String(logsource.service).toLowerCase();
      const logService = String(logEntry.service || '').toLowerCase();

      // If log service is "unknown", skip validation (check all rules)
      if (logService !== 'unknown') {
        // Exact match or wildcard match
        if (servicePattern.includes('*')) {
          const regex = new RegExp(`^${servicePattern.replace(/\*/g, '.*')}$`);
          if (!regex.test(logService)) {
            return false;
          }
        } else if (logService !== servicePattern) {
          return false;
        }
      }
    }

    // Match product field (if present in log metadata)
    if (logsource.product) {
      const productPattern = String(logsource.product).toLowerCase();

      // Skip validation if product is "any" (matches all logs)
      if (productPattern !== 'any') {
        const logProduct = String(
          logEntry.metadata?.product || logEntry.product || ''
        ).toLowerCase();

        // If log product is "unknown", skip validation (check all rules)
        if (logProduct !== 'unknown') {
          if (productPattern.includes('*')) {
            const regex = new RegExp(`^${productPattern.replace(/\*/g, '.*')}$`);
            if (!regex.test(logProduct)) {
              return false;
            }
          } else if (logProduct !== productPattern) {
            return false;
          }
        }
      }
    }

    // Match category field (if present in log metadata)
    if (logsource.category) {
      const categoryPattern = String(logsource.category).toLowerCase();
      const logCategory = String(
        logEntry.metadata?.category || logEntry.category || logEntry.service || ''
      ).toLowerCase();

      // If log category is "unknown", skip validation (check all rules)
      if (logCategory !== 'unknown') {
        if (categoryPattern.includes('*')) {
          const regex = new RegExp(`^${categoryPattern.replace(/\*/g, '.*')}$`);
          if (!regex.test(logCategory)) {
            return false;
          }
        } else if (logCategory !== categoryPattern) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Flatten log entry to support nested field access
   */
  private static flattenLogEntry(logEntry: LogEntry): Record<string, any> {
    const flattened: Record<string, any> = {};

    // Add top-level fields
    Object.entries(logEntry).forEach(([key, value]) => {
      if (typeof value !== 'object' || value === null) {
        flattened[key] = value;
      }
    });

    // Flatten metadata
    if (logEntry.metadata && typeof logEntry.metadata === 'object') {
      this.flattenObject(logEntry.metadata, 'metadata', flattened);

      // Also add metadata fields at root level for easier matching
      Object.entries(logEntry.metadata).forEach(([key, value]) => {
        if (!(key in flattened)) {
          flattened[key] = value;
        }
      });
    }

    return flattened;
  }

  /**
   * Recursively flatten nested object
   */
  private static flattenObject(
    obj: Record<string, any>,
    prefix: string,
    result: Record<string, any>
  ): void {
    Object.entries(obj).forEach(([key, value]) => {
      const newKey = `${prefix}.${key}`;

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Recursively flatten nested objects
        this.flattenObject(value, newKey, result);
      } else {
        // Add primitive or array value
        result[newKey] = value;
      }
    });
  }

  /**
   * Batch evaluate multiple logs
   */
  static async evaluateBatch(
    logs: LogEntry[],
    organizationId: string,
    projectId?: string
  ): Promise<Map<number, DetectionResult>> {
    const results = new Map<number, DetectionResult>();

    // Load rules once for the entire batch
    const rules = await this.loadActiveRules(organizationId, projectId);

    if (rules.length === 0) {
      // No active rules, return empty results
      logs.forEach((_, index) => {
        results.set(index, { matched: false, matchedRules: [] });
      });
      return results;
    }

    // Evaluate each log
    for (let i = 0; i < logs.length; i++) {
      const logEntry = logs[i];
      const flattenedLog = this.flattenLogEntry(logEntry);
      const matchedRules: MatchedRule[] = [];

      for (const rule of rules) {
        try {
          const logsourceMatched = this.matchLogsource(rule.logsource, logEntry);
          if (!logsourceMatched) {
            continue;
          }

          const matched = SigmaConditionEvaluator.evaluateDetection(
            rule.detection,
            flattenedLog,
            false
          );

          if (matched) {
            // Extract matched fields from detection patterns
            const matchedFields = this.extractMatchedFields(rule.detection, flattenedLog);

            matchedRules.push({
              sigmaRuleId: rule.id,
              ruleTitle: rule.title,
              ruleLevel: rule.level || 'medium',
              ruleTags: rule.tags,
              matchedAt: new Date(),
              matchedFields,
            });
          }
        } catch (error) {
          console.error(
            `[SigmaDetectionEngine] Error evaluating rule ${rule.id}:`,
            error
          );
        }
      }

      results.set(i, {
        matched: matchedRules.length > 0,
        matchedRules,
      });
    }

    return results;
  }

  /**
   * Extract matched fields from detection patterns
   * Returns the field names and values that were checked in the detection
   */
  private static extractMatchedFields(
    detection: any,
    flattenedLog: Record<string, any>
  ): Record<string, any> {
    const matchedFields: Record<string, any> = {};

    try {
      // Extract field names from all detection patterns
      const patterns = Object.keys(detection).filter(k => k !== 'condition' && k !== 'timeframe');

      for (const patternKey of patterns) {
        const pattern = detection[patternKey];

        if (typeof pattern === 'object' && pattern !== null) {
          // Extract field names from the pattern
          Object.keys(pattern).forEach(fieldName => {
            // If this field exists in the log, include it
            if (fieldName in flattenedLog) {
              matchedFields[fieldName] = flattenedLog[fieldName];
            }
          });
        }
      }
    } catch (error) {
      console.error('[SigmaDetectionEngine] Error extracting matched fields:', error);
    }

    return matchedFields;
  }
}
