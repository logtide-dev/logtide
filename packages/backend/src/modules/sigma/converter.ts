import type { ParsedSigmaRule, SigmaConversionResult } from './types.js';

/**
 * Convert Sigma rules to LogTide Alert Rules
 *
 * Phase 1: Basic conversion (threshold-based)
 * - Maps logsource.service → Alert Rule service filter
 * - Maps Sigma level → Alert Rule threshold
 * - Simple field matching (no complex conditions yet)
 */
export class SigmaConverter {
  /**
   * Convert Sigma rule to LogTide Alert Rule
   */
  static convert(
    sigmaRule: ParsedSigmaRule,
    options: {
      organizationId: string;
      projectId?: string;
      emailRecipients?: string[];
      webhookUrl?: string;
    }
  ): SigmaConversionResult {
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      // Extract service from logsource
      const service = this.extractService(sigmaRule.logsource);
      if (!service) {
        warnings.push(
          'No service found in logsource. Alert will apply to all services.'
        );
      }

      // Extract log levels
      const levels = this.extractLogLevels(sigmaRule);

      // Map Sigma level to threshold
      const { threshold, timeWindow } = this.mapSeverityToThreshold(
        sigmaRule.level
      );

      // Extract detection keywords for metadata
      const detectionKeywords = this.extractDetectionKeywords(
        sigmaRule.detection
      );

      // Build Alert Rule
      const alertRule = {
        name: sigmaRule.title,
        enabled: true,
        service,
        level: levels,
        threshold,
        timeWindow,
        emailRecipients: options.emailRecipients || [],
        webhookUrl: options.webhookUrl,
        metadata: {
          sigma_id: sigmaRule.id,
          sigma_title: sigmaRule.title,
          sigma_level: sigmaRule.level,
          sigma_status: sigmaRule.status,
          sigma_author: sigmaRule.author,
          sigma_description: sigmaRule.description,
          sigma_tags: sigmaRule.tags,
          sigma_references: sigmaRule.references,
          detection_keywords: detectionKeywords,
          logsource: sigmaRule.logsource,
        },
      };

      // Check for advanced Sigma features (fully supported by Detection Engine)
      const advancedFeatures = this.checkAdvancedFeatures(sigmaRule);

      const conversionNotes = this.buildConversionNotes(
        sigmaRule,
        warnings,
        advancedFeatures
      );

      return {
        success: true,
        alertRule,
        warnings,
        errors,
        conversionNotes,
      };
    } catch (error) {
      if (error instanceof Error) {
        errors.push(`Conversion failed: ${error.message}`);
      } else {
        errors.push('Conversion failed: unknown error');
      }

      return {
        success: false,
        warnings,
        errors,
        conversionNotes: 'Conversion failed',
      };
    }
  }

  /**
   * Extract service name from logsource
   */
  private static extractService(logsource: Record<string, any>): string | undefined {
    // For generic categories (webserver, proxy, etc.), don't filter by service
    // because logs can come with different service names (unknown, nginx, apache, etc.)
    // Detection should be based on message content, not service name
    const genericCategories = ['webserver', 'proxy', 'firewall', 'dns', 'antivirus'];
    if (genericCategories.includes(logsource.category)) {
      return undefined;
    }

    // Only use specific service names (e.g., "nginx", "apache", "sshd")
    return logsource.service || logsource.product;
  }

  /**
   * Extract log levels from Sigma rule
   */
  private static extractLogLevels(_rule: ParsedSigmaRule): string[] {
    // Sigma rules should check ALL log levels because detection is based on
    // content (pattern matching), not log severity.
    // A security event can be logged at any level (info, debug, warn, error, etc.)
    return ['debug', 'info', 'warn', 'error', 'critical'];
  }

  /**
   * Map Sigma severity level to alert threshold
   */
  private static mapSeverityToThreshold(
    level: 'informational' | 'low' | 'medium' | 'high' | 'critical'
  ): { threshold: number; timeWindow: number } {
    const mapping = {
      critical: { threshold: 1, timeWindow: 60 }, // 1 occurrence in 1 min
      high: { threshold: 3, timeWindow: 300 }, // 3 occurrences in 5 min
      medium: { threshold: 5, timeWindow: 600 }, // 5 occurrences in 10 min
      low: { threshold: 10, timeWindow: 1800 }, // 10 occurrences in 30 min
      informational: { threshold: 20, timeWindow: 3600 }, // 20 occurrences in 1 hour
    };

    return mapping[level];
  }

  /**
   * Extract detection keywords from detection logic
   */
  private static extractDetectionKeywords(
    detection: Record<string, any>
  ): string[] {
    const keywords: string[] = [];

    // Recursively extract string values from detection selections
    const extract = (obj: any): void => {
      if (typeof obj === 'string') {
        keywords.push(obj);
      } else if (Array.isArray(obj)) {
        obj.forEach(extract);
      } else if (typeof obj === 'object' && obj !== null) {
        Object.values(obj).forEach(extract);
      }
    };

    // Skip the 'condition' field
    const { condition, ...selections } = detection;
    extract(selections);

    return [...new Set(keywords)]; // Remove duplicates
  }

  /**
   * Check for advanced Sigma features (fully supported by Detection Engine)
   */
  private static checkAdvancedFeatures(rule: ParsedSigmaRule): string[] {
    const advanced: string[] = [];

    const condition = rule.detection.condition;

    // Check for complex conditions
    if (
      typeof condition === 'string' &&
      (condition.includes('and') ||
        condition.includes('or') ||
        condition.includes('not') ||
        condition.includes('1 of') ||
        condition.includes('all of'))
    ) {
      advanced.push('complex conditions (AND/OR/NOT)');
    }

    // Check for field modifiers
    const detectionStr = JSON.stringify(rule.detection);
    if (detectionStr.includes('|contains') || detectionStr.includes('|endswith')) {
      advanced.push('field modifiers (contains, endswith, etc.)');
    }

    // Check for wildcards
    if (detectionStr.includes('*') || detectionStr.includes('?')) {
      advanced.push('wildcards (* and ?)');
    }

    // Check for regex
    if (detectionStr.includes('|re')) {
      advanced.push('regex patterns');
    }

    return advanced;
  }

  /**
   * Build human-readable conversion notes
   */
  private static buildConversionNotes(
    rule: ParsedSigmaRule,
    warnings: string[],
    advancedFeatures: string[]
  ): string {
    const notes: string[] = [];

    notes.push(
      `✅ Successfully converted Sigma rule "${rule.title}" (level: ${rule.level}).`
    );

    notes.push(
      '\n🚀 Sigma Detection Engine Active:\n' +
        `The Detection Engine provides FULL REAL-TIME support for:\n` +
        `  ✓ Complex boolean conditions (AND/OR/NOT)\n` +
        `  ✓ Quantifiers (1 of, all of)\n` +
        `  ✓ Field modifiers (contains, startswith, endswith, regex)\n` +
        `  ✓ Wildcards (* and ?)\n` +
        `  ✓ All log levels (debug, info, warn, error, critical)\n\n` +
        `Email and webhook notifications will be sent when the Sigma rule matches.`
    );

    if (advancedFeatures.length > 0) {
      notes.push(
        `\n📋 Advanced features detected: ${advancedFeatures.join(', ')}`
      );
    }

    if (warnings.length > 0) {
      notes.push('\n⚠️  Notes:\n' + warnings.map((w) => `- ${w}`).join('\n'));
    }

    notes.push(
      '\n✅ Status: ACTIVE - This Sigma rule is being evaluated against all incoming logs.'
    );

    return notes.join('\n');
  }
}
