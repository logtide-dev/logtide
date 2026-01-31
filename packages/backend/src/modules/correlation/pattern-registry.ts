/**
 * Pattern Registry for Identifier Extraction
 *
 * Provides extensible patterns to detect common identifiers in log messages
 * and metadata fields (request_id, user_id, UUIDs, etc.)
 *
 * Supports:
 * - Default built-in patterns (fallback)
 * - Organization-specific custom patterns (from database)
 * - Pattern caching per organization
 */

import { db } from '../../database/index.js';

export interface PatternDefinition {
  type: string;
  displayName: string;
  pattern: RegExp;
  priority: number; // Lower = higher priority (checked first)
  fieldNames: string[];
  isBuiltIn: boolean;
}

export interface ExtractedIdentifier {
  type: string;
  value: string;
}

export interface CustomPattern {
  id: string;
  organizationId: string;
  name: string;
  displayName: string;
  description: string | null;
  pattern: string;
  fieldNames: string[];
  enabled: boolean;
  priority: number;
}

// Default built-in patterns
const DEFAULT_PATTERNS: Omit<PatternDefinition, 'isBuiltIn'>[] = [
  // UUID v4 (RFC 4122)
  {
    type: 'uuid',
    displayName: 'UUID',
    pattern: /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi,
    priority: 100,
    fieldNames: ['id', 'uuid', 'guid'],
  },
  // Request ID patterns
  {
    type: 'request_id',
    displayName: 'Request ID',
    pattern: /\b(?:req(?:uest)?[-_]?id|requestId)[:=\s]["']?([a-zA-Z0-9\-_]{8,64})["']?/gi,
    priority: 90,
    fieldNames: ['request_id', 'requestId', 'req_id', 'reqId', 'x-request-id'],
  },
  // Prefixed request IDs (req_xxx, request-xxx)
  {
    type: 'request_id',
    displayName: 'Request ID',
    pattern: /\b(req[-_][a-zA-Z0-9\-_]{6,32})\b/gi,
    priority: 89,
    fieldNames: [],
  },
  // Session ID patterns
  {
    type: 'session_id',
    displayName: 'Session ID',
    pattern: /\b(?:sess(?:ion)?[-_]?id|sessionId)[:=\s]["']?([a-zA-Z0-9\-_]{16,128})["']?/gi,
    priority: 85,
    fieldNames: ['session_id', 'sessionId', 'sid', 'session'],
  },
  // Prefixed session IDs (sess_xxx, session-xxx)
  {
    type: 'session_id',
    displayName: 'Session ID',
    pattern: /\b(sess[-_][a-zA-Z0-9\-_]{8,64})\b/gi,
    priority: 84,
    fieldNames: [],
  },
  // User ID patterns
  {
    type: 'user_id',
    displayName: 'User ID',
    pattern: /\b(?:user[-_]?id|userId|uid)[:=\s]["']?([a-zA-Z0-9\-_]{1,64})["']?/gi,
    priority: 80,
    fieldNames: ['user_id', 'userId', 'uid', 'user'],
  },
  // Prefixed user IDs (user_xxx, usr_xxx)
  {
    type: 'user_id',
    displayName: 'User ID',
    pattern: /\b(user[-_][a-zA-Z0-9\-_]{1,32})\b/gi,
    priority: 79,
    fieldNames: [],
  },
  // Transaction ID patterns
  {
    type: 'transaction_id',
    displayName: 'Transaction ID',
    pattern: /\b(?:tx(?:n)?[-_]?id|transactionId)[:=\s]["']?([a-zA-Z0-9\-_]{8,64})["']?/gi,
    priority: 75,
    fieldNames: ['transaction_id', 'transactionId', 'tx_id', 'txId', 'txn_id', 'txnId'],
  },
  // Prefixed transaction IDs (txn_xxx, tx_xxx)
  {
    type: 'transaction_id',
    displayName: 'Transaction ID',
    pattern: /\b(txn?[-_][a-zA-Z0-9\-_]{6,32})\b/gi,
    priority: 74,
    fieldNames: [],
  },
  // Order ID patterns
  {
    type: 'order_id',
    displayName: 'Order ID',
    pattern: /\b(?:order[-_]?id|orderId)[:=\s]["']?([a-zA-Z0-9\-_]{4,64})["']?/gi,
    priority: 70,
    fieldNames: ['order_id', 'orderId', 'order'],
  },
  // Prefixed order IDs (order_xxx, ord_xxx)
  {
    type: 'order_id',
    displayName: 'Order ID',
    pattern: /\b(ord(?:er)?[-_][a-zA-Z0-9\-_]{4,32})\b/gi,
    priority: 69,
    fieldNames: [],
  },
  // Correlation ID patterns
  {
    type: 'correlation_id',
    displayName: 'Correlation ID',
    pattern: /\b(?:corr(?:elation)?[-_]?id|correlationId|x-correlation-id)[:=\s]["']?([a-zA-Z0-9\-_]{8,64})["']?/gi,
    priority: 65,
    fieldNames: ['correlation_id', 'correlationId', 'corr_id', 'x-correlation-id'],
  },
  // Prefixed correlation IDs (corr_xxx)
  {
    type: 'correlation_id',
    displayName: 'Correlation ID',
    pattern: /\b(corr[-_][a-zA-Z0-9\-_]{6,32})\b/gi,
    priority: 64,
    fieldNames: [],
  },
  // OpenTelemetry Trace ID (32 hex chars)
  {
    type: 'trace_id',
    displayName: 'Trace ID',
    pattern: /\b(?:trace[-_]?id|traceId)[:=\s]["']?([a-f0-9]{32})["']?/gi,
    priority: 60,
    fieldNames: ['trace_id', 'traceId', 'x-trace-id'],
  },
  // OpenTelemetry Span ID (16 hex chars)
  {
    type: 'span_id',
    displayName: 'Span ID',
    pattern: /\b(?:span[-_]?id|spanId)[:=\s]["']?([a-f0-9]{16})["']?/gi,
    priority: 55,
    fieldNames: ['span_id', 'spanId', 'x-span-id'],
  },
];

export class IdentifierPatternRegistry {
  // Cache per organization (orgId -> patterns)
  private orgPatternCache = new Map<string, PatternDefinition[]>();
  private cacheExpiry = new Map<string, number>();
  private cacheTTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get patterns for an organization (with caching)
   */
  async getPatternsForOrg(organizationId: string): Promise<PatternDefinition[]> {
    // Check cache
    const cached = this.orgPatternCache.get(organizationId);
    const expiry = this.cacheExpiry.get(organizationId);
    if (cached && expiry && Date.now() < expiry) {
      return cached;
    }

    // Load from database
    const customPatterns = await this.loadCustomPatterns(organizationId);

    // Merge with defaults
    const patterns = this.mergePatterns(customPatterns);

    // Cache result
    this.orgPatternCache.set(organizationId, patterns);
    this.cacheExpiry.set(organizationId, Date.now() + this.cacheTTL);

    return patterns;
  }

  /**
   * Get default patterns (no org-specific customization)
   */
  getDefaultPatterns(): PatternDefinition[] {
    return DEFAULT_PATTERNS.map((p) => ({ ...p, isBuiltIn: true }));
  }

  /**
   * Load custom patterns from database for an organization
   */
  private async loadCustomPatterns(organizationId: string): Promise<CustomPattern[]> {
    try {
      const rows = await db
        .selectFrom('identifier_patterns')
        .selectAll()
        .where('organization_id', '=', organizationId)
        .where('enabled', '=', true)
        .orderBy('priority', 'asc')
        .execute();

      return rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        displayName: row.display_name,
        description: row.description,
        pattern: row.pattern,
        fieldNames: row.field_names || [],
        enabled: row.enabled,
        priority: row.priority,
      }));
    } catch (error) {
      console.error('[PatternRegistry] Failed to load custom patterns:', error);
      return [];
    }
  }

  /**
   * Merge custom patterns with defaults
   * Custom patterns with lower priority numbers come first
   */
  private mergePatterns(customPatterns: CustomPattern[]): PatternDefinition[] {
    const patterns: PatternDefinition[] = [];

    // Add custom patterns first (they have priority)
    for (const custom of customPatterns) {
      try {
        patterns.push({
          type: custom.name,
          displayName: custom.displayName,
          pattern: new RegExp(custom.pattern, 'gi'),
          priority: custom.priority,
          fieldNames: custom.fieldNames,
          isBuiltIn: false,
        });
      } catch (error) {
        console.error(`[PatternRegistry] Invalid regex for pattern ${custom.name}:`, error);
      }
    }

    // Add default patterns
    for (const def of DEFAULT_PATTERNS) {
      patterns.push({ ...def, isBuiltIn: true });
    }

    // Sort by priority (lower = higher priority)
    patterns.sort((a, b) => a.priority - b.priority);

    return patterns;
  }

  /**
   * Invalidate cache for an organization (call after pattern changes)
   */
  invalidateCache(organizationId: string): void {
    this.orgPatternCache.delete(organizationId);
    this.cacheExpiry.delete(organizationId);
  }

  /**
   * Extract identifiers from text using patterns for an organization
   */
  async extractFromText(
    text: string,
    organizationId?: string
  ): Promise<ExtractedIdentifier[]> {
    const patterns = organizationId
      ? await this.getPatternsForOrg(organizationId)
      : this.getDefaultPatterns();

    return this.extractWithPatterns(text, patterns);
  }

  /**
   * Extract identifiers from text using provided patterns (sync version)
   */
  extractWithPatterns(text: string, patterns: PatternDefinition[]): ExtractedIdentifier[] {
    const matches: ExtractedIdentifier[] = [];
    const seen = new Set<string>();

    for (const { type, pattern } of patterns) {
      // Create new regex instance to reset lastIndex
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;

      while ((match = regex.exec(text)) !== null) {
        // Use first capture group if exists, otherwise full match
        const value = match[1] || match[0];
        const key = `${type}:${value.toLowerCase()}`;

        if (!seen.has(key)) {
          matches.push({ type, value });
          seen.add(key);
        }
      }
    }

    return matches;
  }

  /**
   * Check if a field name matches known identifier patterns
   * Returns the identifier type and value if matched
   */
  matchFieldName(
    fieldName: string,
    value: unknown,
    patterns: PatternDefinition[]
  ): ExtractedIdentifier | null {
    if (typeof value !== 'string' || value.length === 0) {
      return null;
    }

    for (const pattern of patterns) {
      if (pattern.fieldNames.length === 0) continue;

      if (pattern.fieldNames.some((name) => name.toLowerCase() === fieldName.toLowerCase())) {
        return {
          type: pattern.type,
          value,
        };
      }
    }

    return null;
  }
}

// Singleton instance
export const patternRegistry = new IdentifierPatternRegistry();
