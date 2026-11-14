/**
 * Monitor > Hardware REST API (session auth). Contract:
 * `@logtide/shared` HardwareHostListResponse / HardwareHostDetailResponse /
 * HardwareEventsResponse / HardwareHostUpdateInput.
 *
 * Access: any member of the host's organization reads; owners and admins
 * mute and delete. A host or project outside the caller's organizations is a
 * 404, never a 403, so ids of other tenants cannot be probed.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  HardwareEventsResponse,
  HardwareHostDetailResponse,
  HardwareHostListResponse,
  HardwareHostSummary,
} from '@logtide/shared';
import { authenticate } from '../auth/middleware.js';
import { db } from '../../database/index.js';
import { resolveHardwarePagerDuty } from './notifier.js';
import {
  forgetHost,
  findHostForUser,
  listHostsByProject,
  setHostMuted,
  toHostDetail,
  toHostSummary,
} from './repository.js';
import { EVENTS_DEFAULT_LIMIT, EVENTS_MAX_LIMIT, loadHostEvents, loadHostSeries } from './series.js';

const idSchema = z.string().guid();
const listQuerySchema = z.object({ projectId: z.string().guid() });
const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(EVENTS_MAX_LIMIT).default(EVENTS_DEFAULT_LIMIT),
});
const updateBodySchema = z.object({ muted: z.boolean() }).strict();

const NOT_FOUND = { error: 'Hardware host not found' };
const isAdminRole = (role: string) => role === 'owner' || role === 'admin';

/** The organization of a live project the user is a member of, or undefined. */
async function projectOrgForUser(projectId: string, userId: string): Promise<string | undefined> {
  const row = await db
    .selectFrom('projects')
    .innerJoin('organization_members', (join) =>
      join
        .onRef('organization_members.organization_id', '=', 'projects.organization_id')
        .on('organization_members.user_id', '=', userId)
    )
    .select('projects.organization_id')
    .where('projects.id', '=', projectId)
    .where('projects.deleted_at', 'is', null)
    .executeTakeFirst();
  return row?.organization_id;
}

export async function hardwareRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  fastify.get('/hosts', async (request: any, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'projectId must be a valid UUID' });
    const organizationId = await projectOrgForUser(parsed.data.projectId, request.user.id);
    if (!organizationId) return reply.status(404).send({ error: 'Project not found' });
    const rows = await listHostsByProject(parsed.data.projectId, organizationId);
    const body: HardwareHostListResponse = { hosts: rows.map(toHostSummary) };
    return body;
  });

  fastify.get('/hosts/:id', async (request: any, reply) => {
    const id = idSchema.safeParse(request.params?.id);
    if (!id.success) return reply.status(404).send(NOT_FOUND);
    const found = await findHostForUser(id.data, request.user.id);
    if (!found) return reply.status(404).send(NOT_FOUND);
    const host = toHostDetail(found.row);
    const series = await loadHostSeries(
      { projectId: found.row.project_id, organizationId: found.row.organization_id, hostName: found.row.host_name },
      host.snapshot
    );
    const body: HardwareHostDetailResponse = { host, series };
    return body;
  });

  fastify.get('/hosts/:id/events', async (request: any, reply) => {
    const id = idSchema.safeParse(request.params?.id);
    if (!id.success) return reply.status(404).send(NOT_FOUND);
    const query = eventsQuerySchema.safeParse(request.query ?? {});
    if (!query.success) return reply.status(400).send({ error: `limit must be between 1 and ${EVENTS_MAX_LIMIT}` });
    const found = await findHostForUser(id.data, request.user.id);
    if (!found) return reply.status(404).send(NOT_FOUND);
    const events = await loadHostEvents(
      { projectId: found.row.project_id, hostName: found.row.host_name },
      query.data.limit
    );
    const body: HardwareEventsResponse = { events };
    return body;
  });

  fastify.patch('/hosts/:id', async (request: any, reply) => {
    const id = idSchema.safeParse(request.params?.id);
    if (!id.success) return reply.status(404).send(NOT_FOUND);
    const body = updateBodySchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Body must be { muted: boolean }' });
    const found = await findHostForUser(id.data, request.user.id);
    if (!found) return reply.status(404).send(NOT_FOUND);
    if (!isAdminRole(found.role)) {
      return reply.status(403).send({ error: 'Only organization owners and admins can mute hardware hosts' });
    }
    const row = await setHostMuted(id.data, found.row.organization_id, body.data.muted);
    if (!row) return reply.status(404).send(NOT_FOUND);
    const res: { host: HardwareHostSummary } = { host: toHostSummary(row) };
    return res;
  });

  fastify.delete('/hosts/:id', async (request: any, reply) => {
    const id = idSchema.safeParse(request.params?.id);
    if (!id.success) return reply.status(404).send(NOT_FOUND);
    const found = await findHostForUser(id.data, request.user.id);
    if (!found) return reply.status(404).send(NOT_FOUND);
    if (!isAdminRole(found.role)) {
      return reply.status(403).send({ error: 'Only organization owners and admins can delete hardware hosts' });
    }
    // Delete and resolve in one transaction: the incident keeps its row but
    // loses the host link, and is never left open without its host.
    const forgotten = await forgetHost(id.data, found.row.organization_id, new Date());
    if (!forgotten) return reply.status(404).send(NOT_FOUND);
    const project = await db
      .selectFrom('projects')
      .select('name')
      .where('id', '=', found.row.project_id)
      .where('organization_id', '=', found.row.organization_id)
      .executeTakeFirst();
    const host = {
      id: found.row.id,
      hostName: found.row.host_name,
      projectId: found.row.project_id,
      projectName: project?.name ?? '',
      organizationId: found.row.organization_id,
    };
    for (const incidentId of forgotten.incidentIds) {
      await resolveHardwarePagerDuty(host, incidentId, 'forgotten');
    }
    return reply.status(204).send();
  });
}
