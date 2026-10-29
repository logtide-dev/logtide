// Seeds logs through the reservoir (not raw SQL) so the integration tests that
// use it run unchanged on TimescaleDB, ClickHouse and MongoDB.

import type { LogLevel } from '@logtide/shared';
import type { LogRecord, StoredLogRecord } from '@logtide/reservoir';
import { reservoir, reservoirReady } from '../../../database/reservoir.js';

export interface SeedRow {
  message: string;
  service?: string;
  level?: LogLevel;
  time?: Date;
  metadata?: Record<string, unknown>;
  traceId?: string;
  sessionId?: string;
  spanId?: string;
}

/** Inserts the rows into `projectId` and returns them in input order. Defaults: service 'api', level 'info', time now. */
export async function seedLogs(projectId: string, rows: SeedRow[]): Promise<StoredLogRecord[]> {
  await reservoirReady;
  if (rows.length === 0) return [];
  const now = new Date();
  const records: LogRecord[] = rows.map((row) => ({
    time: row.time ?? now,
    projectId,
    service: row.service ?? 'api',
    level: row.level ?? 'info',
    message: row.message,
    metadata: row.metadata,
    traceId: row.traceId,
    sessionId: row.sessionId,
    spanId: row.spanId,
  }));
  const result = await reservoir.ingestReturning(records);
  return result.rows;
}
