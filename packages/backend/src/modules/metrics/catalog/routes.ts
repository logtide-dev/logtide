/**
 * Metric catalog REST API (session auth). Contract: `@logtide/shared`
 * metrics/catalog.ts (MetricCatalogEntry / MetricCatalogDetail / ...).
 *
 *   GET /catalog            list of metrics (name, type, unit, projects, last seen)
 *   GET /catalog/entry      one metric with attributes, sources and dashboards
 *   GET /attributes         attribute keys of a metric (or of the resources)
 *   GET /attribute-values   sample values of one attribute key
 *
 * Every route needs `organizationId`, a session user that is a member of it,
 * and optional `projectIds` (comma list or repeated, absent = every project of
 * the organization) resolved by the query service's resolveProjectScope.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type {
  MetricCatalogAttribute,
  MetricCatalogDetail,
  MetricCatalogEntry,
  MetricCatalogListResponse,
} from '@logtide/shared';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
import { resolveProjectScope, MetricScopeError } from '../query/service.js';

/**
 * /catalog/entry reservoir call budget: label keys are fetched once per scope
 * (2 calls), values for at most ATTRIBUTE_KEYS_CAP keys per scope with
 * ENTRY_VALUES_CONCURRENCY in flight, and host.name / service.name values come
 * from one call each (SOURCE_VALUES_CAP) that is reused for the attribute list
 * when the key is one of the listed attributes. Worst case:
 * 2 + 2 * ATTRIBUTE_KEYS_CAP + 2 = 44 calls, never more than 4 at a time.
 */
const ATTRIBUTE_KEYS_CAP = 20;
const ATTRIBUTE_VALUES_CAP = 20;
const SOURCE_VALUES_CAP = 200;
const ENTRY_VALUES_CONCURRENCY = 4;
const LIST_ROW_CAP = 5000;
const DEFAULT_WINDOW_MS = 24 * 3600_000;
/** Longest window /attributes and /attribute-values accept. */
export const MAX_ATTRIBUTE_WINDOW_MS = 31 * 24 * 3600_000;
const DETAIL_PAD_MS = 3600_000;

const guid = z.string().guid();

const baseQuery = z.object({
  organizationId: guid,
  projectIds: z.union([z.string(), z.array(z.string())]).optional(),
});

const listQuery = baseQuery.extend({
  search: z.string().max(200).optional(),
  prefix: z.string().max(200).optional(),
});
const entryQuery = baseQuery.extend({ name: z.string().min(1).max(512) });
const timeRange = {
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
};
const scopeEnum = z.enum(['metric', 'resource']).default('metric');
const attributesQuery = baseQuery.extend({
  metricName: z.string().max(512).optional(),
  scope: scopeEnum,
  ...timeRange,
});
const valuesQuery = baseQuery.extend({
  metricName: z.string().max(512).optional(),
  scope: scopeEnum,
  key: z.string().min(1).max(256),
  ...timeRange,
});

function parseProjectIds(raw: string | string[] | undefined): string[] | null | 'invalid' {
  if (raw === undefined) return null;
  const parts = (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v !== '');
  if (parts.length === 0) return null;
  if (!parts.every((p) => guid.safeParse(p).success)) return 'invalid';
  return [...new Set(parts)];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface Scope {
  organizationId: string;
  userId: string;
  projectIds: string[];
}

/** Validate the common params, check membership and resolve the project scope; sends the error reply itself. */
async function authorize(
  request: any,
  reply: FastifyReply,
  base: z.infer<typeof baseQuery>
): Promise<Scope | null> {
  const userId: string | undefined = request.user?.id;
  if (!userId) {
    reply.code(403).send({ error: 'Session authentication required' });
    return null;
  }
  const parsedIds = parseProjectIds(base.projectIds);
  if (parsedIds === 'invalid') {
    reply.code(400).send({ error: 'projectIds must be valid UUIDs' });
    return null;
  }
  const member = await db
    .selectFrom('organization_members')
    .select('user_id')
    .where('organization_id', '=', base.organizationId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!member) {
    reply.code(403).send({ error: 'Access denied - you are not a member of this organization' });
    return null;
  }
  try {
    const projectIds = await resolveProjectScope(base.organizationId, userId, parsedIds);
    return { organizationId: base.organizationId, userId, projectIds };
  } catch (error) {
    if (error instanceof MetricScopeError) {
      reply.code(403).send({ error: error.message });
      return null;
    }
    throw error;
  }
}

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: error.issues[0]?.message ?? 'Invalid query', details: error.issues });
}

interface CatalogDbRow {
  project_id: string;
  metric_name: string;
  metric_type: string;
  unit: string | null;
  description: string | null;
  is_monotonic: boolean | null;
  temporality: 'cumulative' | 'delta' | null;
  first_seen_at: Date;
  last_seen_at: Date;
}

/** One entry per (name, type): projects merged, first non-null unit/description by most recent project. */
function mergeEntries(rows: CatalogDbRow[]): MetricCatalogEntry[] {
  const sorted = [...rows].sort((a, b) => b.last_seen_at.getTime() - a.last_seen_at.getTime());
  const entries = new Map<string, MetricCatalogEntry>();
  for (const r of sorted) {
    const key = `${r.metric_name}\u0000${r.metric_type}`;
    const existing = entries.get(key);
    if (!existing) {
      entries.set(key, {
        name: r.metric_name,
        type: r.metric_type,
        unit: r.unit,
        description: r.description,
        isMonotonic: r.is_monotonic,
        temporality: r.temporality ?? null,
        projectIds: [r.project_id],
        firstSeen: r.first_seen_at.toISOString(),
        lastSeen: r.last_seen_at.toISOString(),
      });
      continue;
    }
    if (!existing.projectIds.includes(r.project_id)) existing.projectIds.push(r.project_id);
    existing.unit ??= r.unit;
    existing.description ??= r.description;
    existing.isMonotonic ??= r.is_monotonic;
    existing.temporality ??= r.temporality ?? null;
    if (r.first_seen_at.toISOString() < existing.firstSeen) existing.firstSeen = r.first_seen_at.toISOString();
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

async function attributeValues(
  scope: Scope,
  metricName: string,
  attrScope: 'metric' | 'resource',
  key: string,
  from: Date,
  to: Date,
  cap: number
): Promise<string[]> {
  const result = await reservoir.getMetricLabelValues(
    { organizationId: scope.organizationId, projectId: scope.projectIds, metricName, from, to, limit: cap, scope: attrScope },
    key
  );
  return (result.values ?? []).slice(0, cap);
}

async function attributeKeys(
  scope: Scope,
  metricName: string,
  attrScope: 'metric' | 'resource',
  from: Date,
  to: Date
): Promise<string[]> {
  const result = await reservoir.getMetricLabelKeys({
    organizationId: scope.organizationId,
    projectId: scope.projectIds,
    metricName,
    from,
    to,
    scope: attrScope,
  });
  return result.keys ?? [];
}

async function attributesWithValues(
  scope: Scope,
  metricName: string,
  attrScope: 'metric' | 'resource',
  from: Date,
  to: Date,
  known: ReadonlyMap<string, string[]> = new Map()
): Promise<MetricCatalogAttribute[]> {
  const keys = (await attributeKeys(scope, metricName, attrScope, from, to)).slice(0, ATTRIBUTE_KEYS_CAP);
  return mapLimit(keys, ENTRY_VALUES_CONCURRENCY, async (key) => {
    const reuse = known.get(key);
    return {
      key,
      values: reuse
        ? reuse.slice(0, ATTRIBUTE_VALUES_CAP)
        : await attributeValues(scope, metricName, attrScope, key, from, to, ATTRIBUTE_VALUES_CAP),
    };
  });
}

async function dashboardsUsing(
  organizationId: string,
  userId: string,
  metricName: string
): Promise<Array<{ id: string; name: string }>> {
  const rows = await db
    .selectFrom('custom_dashboards')
    .select(['id', 'name'])
    .where('organization_id', '=', organizationId)
    .where((eb) => eb.or([eb('is_personal', '=', false), eb('created_by', '=', userId)]))
    .where(
      sql<boolean>`jsonb_path_exists(
        panels,
        '$[*].config ? (@.type == "metrics").query.queries[*] ? (@.metricName == $name)',
        jsonb_build_object('name', ${metricName}::text)
      )`
    )
    .orderBy('name', 'asc')
    .limit(100)
    .execute();
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

/** Resolve the discovery window (default: last 24h). Returns an error message when it is invalid. */
function windowOf(from?: string, to?: string): { from: Date; to: Date } | { error: string } {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - DEFAULT_WINDOW_MS);
  if (!(start.getTime() < end.getTime())) return { error: 'from must be before to' };
  if (end.getTime() - start.getTime() > MAX_ATTRIBUTE_WINDOW_MS) {
    return { error: 'The time range cannot exceed 31 days' };
  }
  return { from: start, to: end };
}

/** Run fn over items with at most `limit` in flight, keeping the order of results. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function metricCatalogRoutes(fastify: FastifyInstance) {
  // GET /api/v1/metrics/catalog
  fastify.get('/catalog', async (request: any, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const scope = await authorize(request, reply, parsed.data);
    if (!scope) return;
    if (scope.projectIds.length === 0) return { metrics: [] } satisfies MetricCatalogListResponse;

    let query = db
      .selectFrom('metric_catalog')
      .selectAll()
      .where('project_id', 'in', scope.projectIds);
    if (parsed.data.search) {
      query = query.where('metric_name', 'ilike', `%${escapeLike(parsed.data.search)}%`);
    }
    if (parsed.data.prefix) {
      query = query.where('metric_name', 'like', `${escapeLike(parsed.data.prefix)}%`);
    }
    const rows = await query.orderBy('metric_name', 'asc').limit(LIST_ROW_CAP).execute();
    const body: MetricCatalogListResponse = { metrics: mergeEntries(rows as CatalogDbRow[]) };
    return body;
  });

  // GET /api/v1/metrics/catalog/entry
  fastify.get('/catalog/entry', async (request: any, reply) => {
    const parsed = entryQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const scope = await authorize(request, reply, parsed.data);
    if (!scope) return;
    const name = parsed.data.name;

    const rows =
      scope.projectIds.length === 0
        ? []
        : await db
            .selectFrom('metric_catalog')
            .selectAll()
            .where('project_id', 'in', scope.projectIds)
            .where('metric_name', '=', name)
            .execute();
    if (rows.length === 0) return reply.code(404).send({ error: 'Metric not found' });

    // Most recently seen type first when a name was sent with several types.
    const entries = mergeEntries(rows as CatalogDbRow[]).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    const entry = entries[0];
    const lastSeen = new Date(entry.lastSeen).getTime();
    const to = new Date(Math.min(lastSeen + DETAIL_PAD_MS, Date.now()));
    const from = new Date(to.getTime() - DEFAULT_WINDOW_MS);

    // host.name / service.name are fetched once (large cap) and reused below.
    const [hosts, services, dashboards] = await Promise.all([
      attributeValues(scope, name, 'resource', 'host.name', from, to, SOURCE_VALUES_CAP),
      attributeValues(scope, name, 'resource', 'service.name', from, to, SOURCE_VALUES_CAP),
      dashboardsUsing(scope.organizationId, scope.userId, name),
    ]);
    const known = new Map<string, string[]>([
      ['host.name', hosts],
      ['service.name', services],
    ]);
    const metricAttrs = await attributesWithValues(scope, name, 'metric', from, to);
    const resourceAttrs = await attributesWithValues(scope, name, 'resource', from, to, known);

    const body: MetricCatalogDetail = {
      entry,
      attributes: { metric: metricAttrs, resource: resourceAttrs },
      sources: { hosts, services },
      usedIn: { dashboards },
    };
    return body;
  });

  // GET /api/v1/metrics/attributes
  fastify.get('/attributes', async (request: any, reply) => {
    const parsed = attributesQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { metricName, scope: attrScope, from, to } = parsed.data;
    // metricName '' (or absent) means every metric, for both scopes.
    const window = windowOf(from, to);
    if ('error' in window) return reply.code(400).send({ error: window.error });
    const scope = await authorize(request, reply, parsed.data);
    if (!scope) return;
    if (scope.projectIds.length === 0) return { keys: [] };
    return { keys: await attributeKeys(scope, metricName ?? '', attrScope, window.from, window.to) };
  });

  // GET /api/v1/metrics/attribute-values
  fastify.get('/attribute-values', async (request: any, reply) => {
    const parsed = valuesQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { metricName, scope: attrScope, key, from, to } = parsed.data;
    const window = windowOf(from, to);
    if ('error' in window) return reply.code(400).send({ error: window.error });
    const scope = await authorize(request, reply, parsed.data);
    if (!scope) return;
    if (scope.projectIds.length === 0) return { values: [] };
    return {
      values: await attributeValues(scope, metricName ?? '', attrScope, key, window.from, window.to, 100),
    };
  });
}
