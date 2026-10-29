import { db } from '../../database/index.js';
import { reservoir } from '../../database/reservoir.js';
import { encodeSessionCursor } from '@logtide/reservoir';
import { resolveMetadataPath } from '@logtide/shared';
import { parseUserAgent } from './user-agent.js';

/** Largest page the reservoir engines return for listSessions. */
const ENGINE_PAGE_SIZE = 200;
/** Page budget when filtering by error presence on top of the engine. */
const MAX_FILTER_PAGES = 10;
/** Concurrent first-event lookups for entry metadata. */
const ENTRY_LOOKUP_CONCURRENCY = 5;
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SessionSummary {
  sessionId: string;
  service: string;
  firstEvent: string;
  lastEvent: string;
  durationMs: number;
  eventCount: number;
  errorCount: number;
  browser?: string;
  os?: string;
  device?: 'desktop' | 'mobile' | 'tablet';
  entryUrl?: string;
  user?: string;
}

export interface SessionListParams {
  projectId: string;
  from: Date;
  to: Date;
  hasErrors?: boolean;
  service?: string;
  limit: number;
  cursor?: string;
}

export interface SessionEventsParams {
  projectId: string;
  sessionId: string;
  limit?: number;
}

export interface SessionEvent {
  id: string;
  time: string;
  service: string;
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  sessionId?: string;
  errorGroupId?: string;
}

export interface SessionEventsResult {
  events: SessionEvent[];
  window: { from: string; to: string } | null;
  truncated: boolean;
}

function firstString(metadata: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = resolveMetadataPath(metadata, key);
    if (typeof value === 'string' && value !== '') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

class SessionsService {
  /**
   * List sessions for a project through the reservoir (all engines).
   * Cursor pagination only: no total.
   */
  async listSessions(params: SessionListParams): Promise<{
    sessions: SessionSummary[];
    nextCursor?: string;
  }> {
    const { projectId, from, to, hasErrors, service, limit, cursor } = params;

    type Row = Awaited<ReturnType<typeof reservoir.listSessions>>['sessions'][number];
    let rows: Row[];
    let nextCursor: string | undefined;

    if (hasErrors === undefined) {
      const page = await reservoir.listSessions({ projectId, from, to, limit, cursor, service });
      rows = page.sessions;
      nextCursor = page.nextCursor;
    } else {
      // The engines have no error filter: page through them and keep the
      // matching rows, bounded by a page budget.
      rows = [];
      let pageCursor = cursor;
      let resumeCursor: string | undefined;
      let reachedLimit = false;
      let moreAfterLimit = false;
      for (let pagesRead = 0; pagesRead < MAX_FILTER_PAGES && !reachedLimit; pagesRead++) {
        const page = await reservoir.listSessions({
          projectId, from, to, limit: ENGINE_PAGE_SIZE, cursor: pageCursor, service,
        });
        resumeCursor = page.nextCursor;
        for (let i = 0; i < page.sessions.length; i++) {
          const s = page.sessions[i];
          if (hasErrors ? s.errorCount > 0 : s.errorCount === 0) rows.push(s);
          if (rows.length === limit) {
            reachedLimit = true;
            moreAfterLimit = i < page.sessions.length - 1 || page.nextCursor !== undefined;
            break;
          }
        }
        if (reachedLimit || !page.nextCursor) break;
        pageCursor = page.nextCursor;
      }

      if (reachedLimit) {
        if (moreAfterLimit) {
          const last = rows[rows.length - 1];
          nextCursor = encodeSessionCursor(last.lastEvent, last.sessionId);
        }
      } else {
        // Page budget exhausted (or the engine ended): resume where the scan stopped.
        nextCursor = resumeCursor;
      }
    }

    const entries = await mapWithConcurrency(rows, ENTRY_LOOKUP_CONCURRENCY, async (row) => {
      try {
        const first = await reservoir.query({
          projectId,
          sessionId: row.sessionId,
          limit: 1,
          offset: 0,
          sortBy: 'time',
          sortOrder: 'asc',
          from,
          to,
        });
        return first.logs[0]?.metadata as Record<string, unknown> | undefined;
      } catch {
        return undefined;
      }
    });

    const sessions: SessionSummary[] = rows.map((row, index) => {
      const firstEvent = new Date(row.firstEvent);
      const lastEvent = new Date(row.lastEvent);
      const summary: SessionSummary = {
        sessionId: row.sessionId,
        service: row.service,
        firstEvent: firstEvent.toISOString(),
        lastEvent: lastEvent.toISOString(),
        durationMs: lastEvent.getTime() - firstEvent.getTime(),
        eventCount: row.eventCount,
        errorCount: row.errorCount,
      };

      const metadata = entries[index];
      if (metadata) {
        const ua = firstString(metadata, ['browser.userAgent', 'userAgent', 'user_agent']);
        const parsed = parseUserAgent(ua);
        if (parsed.browser) summary.browser = parsed.browser;
        if (parsed.os) summary.os = parsed.os;
        if (parsed.device) summary.device = parsed.device;
        const entryUrl = firstString(metadata, ['page.url', 'page.pathname', 'url']);
        if (entryUrl) summary.entryUrl = entryUrl;
        const user = firstString(metadata, ['user.id', 'user.email', 'userId']);
        if (user) summary.user = user;
      }
      return summary;
    });

    return nextCursor ? { sessions, nextCursor } : { sessions };
  }

  /**
   * Get the events of a session, ordered chronologically, with the error
   * group each error event belongs to.
   */
  async getSessionEvents(params: SessionEventsParams): Promise<SessionEventsResult> {
    const { projectId, sessionId, limit = 1000 } = params;

    const result = await reservoir.query({
      projectId,
      sessionId,
      limit,
      offset: 0,
      from: new Date(0),
      to: new Date(),
      sortBy: 'time',
      sortOrder: 'asc',
    });

    const events: SessionEvent[] = result.logs.map((row) => ({
      id: row.id ?? '',
      time: row.time instanceof Date ? row.time.toISOString() : String(row.time),
      service: row.service,
      level: row.level,
      message: row.message,
      metadata: row.metadata as Record<string, unknown> | undefined,
      traceId: row.traceId,
      spanId: row.spanId,
      sessionId: row.sessionId,
    }));

    if (events.length === 0) {
      return { events, window: null, truncated: false };
    }

    const errorGroups = await this.resolveErrorGroups(projectId, events);
    for (const event of events) {
      const groupId = errorGroups.get(event.id);
      if (groupId) event.errorGroupId = groupId;
    }

    return {
      events,
      window: { from: events[0].time, to: events[events.length - 1].time },
      truncated: result.hasMore === true,
    };
  }

  /** True when the project has at least one session event in the last 24 hours. */
  async hasRecentSessions(projectId: string): Promise<boolean> {
    const to = new Date();
    const from = new Date(to.getTime() - RECENT_WINDOW_MS);
    return reservoir.hasSessions({ projectId, from, to });
  }

  /** Map log id -> error group id for the error and critical events. */
  private async resolveErrorGroups(projectId: string, events: SessionEvent[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const ids = events
      .filter((e) => (e.level === 'error' || e.level === 'critical') && UUID_RE.test(e.id))
      .map((e) => e.id);
    if (ids.length === 0) return map;

    const project = await db
      .selectFrom('projects')
      .select('organization_id')
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!project) return map;

    const rows = await db
      .selectFrom('exceptions as e')
      .innerJoin('error_groups as g', (join) =>
        join
          .onRef('g.fingerprint', '=', 'e.fingerprint')
          .onRef('g.organization_id', '=', 'e.organization_id')
          .onRef('g.project_id', '=', 'e.project_id'),
      )
      .select(['e.log_id as log_id', 'g.id as group_id'])
      .where('e.organization_id', '=', project.organization_id)
      .where('e.project_id', '=', projectId)
      .where('e.log_id', 'in', ids)
      .execute();

    for (const row of rows) map.set(row.log_id, row.group_id);
    return map;
  }
}

export const sessionsService = new SessionsService();
