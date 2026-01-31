/**
 * Correlation Service
 *
 * Handles identifier extraction, storage, and correlation queries
 * for the Event Correlation feature.
 */

import { db } from '../../database/index.js';
import type { LogInput } from '@logtide/shared';
import { patternRegistry, type PatternDefinition } from './pattern-registry.js';

export interface IdentifierMatch {
  type: string;
  value: string;
  sourceField: string;
}

export interface CorrelatedLog {
  id: string;
  time: Date;
  service: string;
  level: string;
  message: string;
  metadata: Record<string, unknown> | null;
  traceId: string | null;
  projectId: string | null;
}

export interface CorrelationResult {
  identifier: {
    type: string;
    value: string;
  };
  logs: CorrelatedLog[];
  total: number;
  timeWindow: {
    from: Date;
    to: Date;
  };
}

export class CorrelationService {
  /**
   * Extract identifiers from a single log entry (async - uses org patterns)
   * Called during ingestion
   */
  async extractIdentifiersAsync(
    log: LogInput,
    organizationId: string
  ): Promise<IdentifierMatch[]> {
    const patterns = await patternRegistry.getPatternsForOrg(organizationId);
    return this.extractIdentifiersWithPatterns(log, patterns);
  }

  /**
   * Extract identifiers from a single log entry (sync - uses default patterns)
   * Fallback for when organizationId is not available
   */
  extractIdentifiers(log: LogInput): IdentifierMatch[] {
    const patterns = patternRegistry.getDefaultPatterns();
    return this.extractIdentifiersWithPatterns(log, patterns);
  }

  /**
   * Extract identifiers using provided patterns
   */
  private extractIdentifiersWithPatterns(
    log: LogInput,
    patterns: PatternDefinition[]
  ): IdentifierMatch[] {
    const matches: IdentifierMatch[] = [];
    const seen = new Set<string>();

    // Helper to add unique matches
    const addMatch = (match: IdentifierMatch) => {
      const key = `${match.type}:${match.value.toLowerCase()}`;
      if (!seen.has(key)) {
        matches.push(match);
        seen.add(key);
      }
    };

    // Extract from message
    const messageMatches = patternRegistry.extractWithPatterns(log.message, patterns);
    for (const m of messageMatches) {
      addMatch({
        type: m.type,
        value: m.value,
        sourceField: 'message',
      });
    }

    // Extract from metadata (nested fields)
    if (log.metadata) {
      const metadataMatches = this.extractFromMetadata(log.metadata, 'metadata', patterns);
      for (const m of metadataMatches) {
        addMatch(m);
      }
    }

    return matches;
  }

  /**
   * Extract identifiers from metadata object (recursive)
   */
  private extractFromMetadata(
    obj: Record<string, unknown>,
    prefix = 'metadata',
    patterns: PatternDefinition[]
  ): IdentifierMatch[] {
    const matches: IdentifierMatch[] = [];

    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = `${prefix}.${key}`;

      if (typeof value === 'string') {
        // Check if field name suggests identifier type
        const fieldMatch = patternRegistry.matchFieldName(key, value, patterns);
        if (fieldMatch) {
          matches.push({
            type: fieldMatch.type,
            value: fieldMatch.value,
            sourceField: fieldPath,
          });
          continue;
        }

        // Pattern matching on value text
        const valueMatches = patternRegistry.extractWithPatterns(value, patterns);
        for (const m of valueMatches) {
          matches.push({
            type: m.type,
            value: m.value,
            sourceField: fieldPath,
          });
        }
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Recurse into nested objects
        const nestedMatches = this.extractFromMetadata(
          value as Record<string, unknown>,
          fieldPath,
          patterns
        );
        matches.push(...nestedMatches);
      }
    }

    return matches;
  }

  /**
   * Store identifiers for a batch of logs
   * Called after log insertion in IngestionService
   */
  async storeIdentifiers(
    logs: Array<{
      id: string;
      time: Date;
      projectId: string;
      organizationId: string;
    }>,
    identifiersByLog: Map<number, IdentifierMatch[]>
  ): Promise<void> {
    const rows: Array<{
      log_id: string;
      log_time: Date;
      project_id: string;
      organization_id: string;
      identifier_type: string;
      identifier_value: string;
      source_field: string;
    }> = [];

    logs.forEach((log, index) => {
      const identifiers = identifiersByLog.get(index) || [];
      for (const identifier of identifiers) {
        rows.push({
          log_id: log.id,
          log_time: log.time,
          project_id: log.projectId,
          organization_id: log.organizationId,
          identifier_type: identifier.type,
          identifier_value: identifier.value,
          source_field: identifier.sourceField,
        });
      }
    });

    if (rows.length === 0) return;

    // Batch insert
    await db.insertInto('log_identifiers').values(rows).execute();
  }

  /**
   * Find correlated logs by identifier value
   * With ±N minutes time window around a reference time
   */
  async findCorrelatedLogs(params: {
    projectId: string;
    identifierValue: string;
    referenceTime?: Date;
    timeWindowMinutes?: number;
    limit?: number;
  }): Promise<CorrelationResult> {
    const {
      projectId,
      identifierValue,
      referenceTime = new Date(),
      timeWindowMinutes = 15,
      limit = 100,
    } = params;

    // Calculate time window
    const windowMs = timeWindowMinutes * 60 * 1000;
    const from = new Date(referenceTime.getTime() - windowMs);
    const to = new Date(referenceTime.getTime() + windowMs);

    // Find log IDs with this identifier in time window
    const identifierRows = await db
      .selectFrom('log_identifiers')
      .select(['log_id', 'identifier_type'])
      .where('identifier_value', '=', identifierValue)
      .where('project_id', '=', projectId)
      .where('log_time', '>=', from)
      .where('log_time', '<=', to)
      .orderBy('log_time', 'desc')
      .limit(limit)
      .execute();

    if (identifierRows.length === 0) {
      return {
        identifier: {
          type: 'unknown',
          value: identifierValue,
        },
        logs: [],
        total: 0,
        timeWindow: { from, to },
      };
    }

    const logIds = identifierRows.map((row) => row.log_id);
    const identifierType = identifierRows[0].identifier_type;

    // Fetch actual logs
    const logs = await db
      .selectFrom('logs')
      .selectAll()
      .where('id', 'in', logIds)
      .where('project_id', '=', projectId)
      .orderBy('time', 'asc') // Chronological order for timeline
      .execute();

    return {
      identifier: {
        type: identifierType,
        value: identifierValue,
      },
      logs: logs.map((log) => ({
        id: log.id,
        time: log.time,
        service: log.service,
        level: log.level,
        message: log.message,
        metadata: log.metadata,
        traceId: log.trace_id,
        projectId: log.project_id,
      })),
      total: logs.length,
      timeWindow: { from, to },
    };
  }

  /**
   * Get all identifiers for a specific log
   * For displaying clickable badges in UI
   */
  async getLogIdentifiers(logId: string): Promise<IdentifierMatch[]> {
    const rows = await db
      .selectFrom('log_identifiers')
      .select(['identifier_type', 'identifier_value', 'source_field'])
      .where('log_id', '=', logId)
      .execute();

    return rows.map((row) => ({
      type: row.identifier_type,
      value: row.identifier_value,
      sourceField: row.source_field,
    }));
  }

  /**
   * Get identifiers for multiple logs (batch)
   * More efficient than calling getLogIdentifiers for each log
   */
  async getLogIdentifiersBatch(
    logIds: string[]
  ): Promise<Map<string, IdentifierMatch[]>> {
    if (logIds.length === 0) {
      return new Map();
    }

    const rows = await db
      .selectFrom('log_identifiers')
      .select(['log_id', 'identifier_type', 'identifier_value', 'source_field'])
      .where('log_id', 'in', logIds)
      .execute();

    const result = new Map<string, IdentifierMatch[]>();

    for (const row of rows) {
      const existing = result.get(row.log_id) || [];
      existing.push({
        type: row.identifier_type,
        value: row.identifier_value,
        sourceField: row.source_field,
      });
      result.set(row.log_id, existing);
    }

    return result;
  }
}

export const correlationService = new CorrelationService();
