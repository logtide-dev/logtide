// Shared querystring handling for every log read endpoint (search, count,
// histogram, facets, live tail): one JSON schema for the filter params, one
// reader that turns them into LogQueryParams, one project access resolver.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { metadataFiltersSchema } from '@logtide/shared';
import type { LogLevel, MetadataFilter } from '@logtide/shared';
import { resolveQueryProjectId } from '../auth/guards.js';
import { verifyProjectAccess } from '../auth/verify-project-access.js';
import type { LogQueryParams, SearchMode } from './service.js';

const LEVEL_ENUM = ['debug', 'info', 'warn', 'error', 'critical'];

const stringOrList = {
  anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
};

/**
 * The filter params shared by every log read endpoint. `q` has no schema
 * length limit on purpose: `buildLogFilter` rejects it with a position, so a
 * too long `q` gets the same `{ error, position }` body as any other q error.
 */
export const LOG_FILTER_QUERYSTRING_PROPERTIES: Record<string, object> = {
  projectId: stringOrList,
  service: stringOrList,
  level: {
    anyOf: [
      { type: 'string', enum: LEVEL_ENUM },
      { type: 'array', items: { type: 'string', enum: LEVEL_ENUM } },
    ],
  },
  hostname: stringOrList,
  traceId: { type: 'string' },
  sessionId: { type: 'string' },
  from: { type: 'string', format: 'date-time' },
  to: { type: 'string', format: 'date-time' },
  q: { type: 'string' },
  searchMode: { type: 'string', enum: ['fulltext', 'substring'], default: 'fulltext' },
  metadata_filters: { type: 'string' },
};

export type LogFilterRequest = Pick<
  LogQueryParams,
  'service' | 'level' | 'hostname' | 'traceId' | 'sessionId' | 'from' | 'to' | 'q' | 'searchMode' | 'metadata_filters'
>;

export type LogFilterReadResult =
  | { ok: true; value: LogFilterRequest }
  | { ok: false; body: { error: string; details?: unknown } };

function readDate(raw: unknown, name: string): { ok: true; value?: Date } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true };
  const value = new Date(String(raw));
  if (Number.isNaN(value.getTime())) return { ok: false, error: `Invalid "${name}" date` };
  return { ok: true, value };
}

/** Reads the shared filter params of a log read request (after Fastify schema validation). */
export function readLogFilterRequest(query: Record<string, unknown>): LogFilterReadResult {
  let metadata_filters: MetadataFilter[] | undefined;
  const rawFilters = query.metadata_filters;
  if (typeof rawFilters === 'string' && rawFilters !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawFilters);
    } catch {
      return { ok: false, body: { error: 'metadata_filters must be valid JSON' } };
    }
    const result = metadataFiltersSchema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, body: { error: 'invalid metadata_filters', details: result.error.issues } };
    }
    metadata_filters = result.data;
  }

  const from = readDate(query.from, 'from');
  if (!from.ok) return { ok: false, body: { error: from.error } };
  const to = readDate(query.to, 'to');
  if (!to.ok) return { ok: false, body: { error: to.error } };
  if (from.value && to.value && from.value.getTime() > to.value.getTime()) {
    return { ok: false, body: { error: '"to" must be after "from"' } };
  }

  const value: LogFilterRequest = {
    service: query.service as string | string[] | undefined,
    level: query.level as LogLevel | LogLevel[] | undefined,
    hostname: query.hostname as string | string[] | undefined,
    traceId: query.traceId as string | undefined,
    sessionId: query.sessionId as string | undefined,
    from: from.value,
    to: to.value,
    q: query.q as string | undefined,
    searchMode: query.searchMode as SearchMode | undefined,
    metadata_filters,
  };
  return { ok: true, value };
}

/**
 * Resolves the projects a log read request may see: API keys stay on their
 * bound project (403 otherwise), session users must be members of every
 * requested project's organization. Returns null when a reply was sent.
 */
export async function resolveAccessibleProjects(
  request: FastifyRequest,
  reply: FastifyReply,
  queryProjectId: string | string[] | undefined,
): Promise<string | string[] | null> {
  const resolved = await resolveQueryProjectId(request, reply, queryProjectId);
  if (resolved === null) return null;

  const empty = resolved === undefined || resolved === '' || (Array.isArray(resolved) && resolved.length === 0);
  if (empty) {
    reply.code(400).send({ error: 'Project context missing - provide projectId query parameter' });
    return null;
  }

  const userId = (request as FastifyRequest & { user?: { id?: string } }).user?.id;
  if (userId) {
    const projectIds = Array.isArray(resolved) ? resolved : [resolved];
    for (const pid of projectIds) {
      if (!(await verifyProjectAccess(pid, userId))) {
        reply.code(403).send({ error: `Access denied - you do not have access to project ${pid}` });
        return null;
      }
    }
  }

  return resolved;
}
