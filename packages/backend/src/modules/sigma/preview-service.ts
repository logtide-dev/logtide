import type { QueryParams, QueryResult, StoredLogRecord } from '@logtide/reservoir';
import type { SigmaPreviewSample, SigmaRulePreviewResult } from '@logtide/shared';
import { db } from '../../database/index.js';
import { reservoir } from '../../database/reservoir.js';
import { SigmaDetectionEngine } from './detection-engine.js';
import { isExceptionActive, matchesException, type ActiveException } from './exceptions.js';
import type { ParsedSigmaRule } from './types.js';

export const PREVIEW_MAX_LOGS = 50_000;
export const PREVIEW_PAGE_SIZE = 1_000;
export const PREVIEW_TIMEOUT_MS = 30_000;
export const PREVIEW_MAX_SAMPLES = 20;
/** The deadline is also checked every this many scanned records. */
export const PREVIEW_DEADLINE_CHECK_EVERY = 100;
const SAMPLE_MESSAGE_MAX = 500;

const RANGE_MS = { '24h': 24 * 3_600_000, '7d': 7 * 24 * 3_600_000 } as const;

export interface PreviewInput {
  organizationId: string;
  rule: ParsedSigmaRule;
  projectIds: string[];
  range: '24h' | '7d';
  exceptions: ActiveException[];
}

export interface PreviewDeps {
  query?: (params: QueryParams) => Promise<QueryResult<StoredLogRecord>>;
  now?: () => Date;
}

/**
 * Run one rule against recent history. Reads logs only through
 * `reservoir.query` (cursor paging), so it works on every storage engine.
 * Scans at most PREVIEW_MAX_LOGS logs and stops after PREVIEW_TIMEOUT_MS,
 * reporting a partial scan instead of failing.
 */
export async function previewRule(
  input: PreviewInput,
  deps: PreviewDeps = {}
): Promise<SigmaRulePreviewResult> {
  const now = deps.now ?? (() => new Date());
  const query =
    deps.query ?? ((params: QueryParams) => reservoir.query(params) as Promise<QueryResult<StoredLogRecord>>);

  const started = now();
  const to = started;
  const from = new Date(to.getTime() - RANGE_MS[input.range]);
  const deadline = started.getTime() + PREVIEW_TIMEOUT_MS;

  const result: SigmaRulePreviewResult = {
    range: input.range,
    from: from.toISOString(),
    to: to.toISOString(),
    scanned: 0,
    matches: 0,
    suppressed: 0,
    truncated: false,
    truncatedReason: null,
    samples: [],
  };
  if (input.projectIds.length === 0) return result;

  // Fail toward alerting: only exceptions that are active right now count.
  const exceptions = input.exceptions.filter((e) => isExceptionActive(e, started));

  let cursor: string | undefined;
  for (;;) {
    const page = await query({
      projectId: input.projectIds,
      from,
      to,
      sortOrder: 'desc',
      limit: PREVIEW_PAGE_SIZE,
      cursor,
    });

    for (const record of page.logs) {
      if (result.scanned >= PREVIEW_MAX_LOGS) {
        result.truncated = true;
        result.truncatedReason = 'max_logs';
        return result;
      }
      if (
        result.scanned > 0 &&
        result.scanned % PREVIEW_DEADLINE_CHECK_EVERY === 0 &&
        now().getTime() >= deadline
      ) {
        result.truncated = true;
        result.truncatedReason = 'timeout';
        return result;
      }
      result.scanned++;

      const entry = SigmaDetectionEngine.toLogEntry(record);
      const flattened = SigmaDetectionEngine.flatten(entry);
      const matched = SigmaDetectionEngine.matchRule(input.rule, entry, flattened);
      if (!matched) continue;

      if (exceptions.some((e) => matchesException(flattened, e))) {
        result.suppressed++;
        continue;
      }

      result.matches++;
      if (result.samples.length < PREVIEW_MAX_SAMPLES) {
        result.samples.push(toSample(record, matched.matchedFields ?? {}));
      }
    }

    if (!page.hasMore || !page.nextCursor) return result;

    if (now().getTime() >= deadline) {
      result.truncated = true;
      result.truncatedReason = 'timeout';
      return result;
    }
    cursor = page.nextCursor;
  }
}

function toSample(record: StoredLogRecord, matchedFields: Record<string, unknown>): SigmaPreviewSample {
  return {
    id: record.id,
    time: new Date(record.time).toISOString(),
    projectId: record.projectId,
    service: record.service,
    level: record.level,
    message: record.message.length > SAMPLE_MESSAGE_MAX ? record.message.slice(0, SAMPLE_MESSAGE_MAX) : record.message,
    matchedFields,
  };
}

export interface PreviewTarget {
  rule: ParsedSigmaRule;
  projectId: string | null;
}

/** The stored rule as the matcher sees it, or null outside the organization. */
export async function loadPreviewTarget(ruleId: string, organizationId: string): Promise<PreviewTarget | null> {
  const row = await db
    .selectFrom('sigma_rules')
    .selectAll()
    .where('id', '=', ruleId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    projectId: row.project_id,
    rule: {
      id: row.id,
      title: row.title,
      description: row.description || undefined,
      level: (row.level || 'medium') as ParsedSigmaRule['level'],
      status: (row.status || 'stable') as ParsedSigmaRule['status'],
      logsource: row.logsource as any,
      detection: row.detection as any,
      tags: row.tags || undefined,
    },
  };
}

/** Rule project when set, else the organization's non-deleted projects. */
export async function resolvePreviewProjectIds(
  organizationId: string,
  ruleProjectId: string | null
): Promise<string[]> {
  if (ruleProjectId) {
    const row = await db
      .selectFrom('projects')
      .select('id')
      .where('id', '=', ruleProjectId)
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? [row.id] : [];
  }
  const rows = await db
    .selectFrom('projects')
    .select('id')
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null)
    .execute();
  return rows.map((r) => r.id);
}
