import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  HardwareEventsResponse,
  HardwareHostDetailResponse,
  HardwareHostListResponse,
} from '@logtide/shared';
import { db } from '../../../database/index.js';
import { build } from '../../../server.js';
import { createTestApiKey, createTestContext, createTestUser } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';
import { metricsService } from '../../../modules/metrics/service.js';
import { incidentsService } from '../../../modules/incidents/service.js';
import { runHardwarePass } from '../../../modules/hardware/evaluation.js';
import { healthyPoints, hwRecords, type HwPoint } from './helpers.js';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const MIN = 60_000;
let seq = 0;

async function setup() {
  const ctx = await createTestContext();
  const orgId = ctx.organization.id;
  const projectId = ctx.project.id;
  const ownerToken = (await createTestSession(ctx.user.id)).token;
  seq += 1;
  const member = await createTestUser({ email: `hw-routes-member-${seq}-${Date.now()}@example.com` });
  await db.insertInto('organization_members').values({ organization_id: orgId, user_id: member.id, role: 'member' }).execute();
  const memberToken = (await createTestSession(member.id)).token;
  const admin = await createTestUser({ email: `hw-routes-admin-${seq}-${Date.now()}@example.com` });
  await db.insertInto('organization_members').values({ organization_id: orgId, user_id: admin.id, role: 'admin' }).execute();
  const adminToken = (await createTestSession(admin.id)).token;

  const host = await db
    .insertInto('hardware_hosts')
    .values({ organization_id: orgId, project_id: projectId, host_name: 'srv-1', last_seen_at: new Date() })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { ctx, orgId, projectId, hostId: host.id, ownerToken, memberToken, adminToken };
}

describe('hardware REST API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires a session', async () => {
    const s = await setup();
    const res = await app.inject({ method: 'GET', url: `/api/v1/hardware/hosts?projectId=${s.projectId}` });
    expect(res.statusCode).toBe(401);
  });

  it('lists the hosts of a project with the summary contract', async () => {
    const s = await setup();
    const now = new Date();
    await metricsService.ingestMetrics(
      hwRecords(
        healthyPoints().map((p) => (p.name === 'hw.temperature' ? { ...p, value: 97 } : p)),
        'srv-1',
        new Date(now.getTime() - 30_000),
        s.projectId,
        s.orgId
      ),
      s.projectId,
      s.orgId
    );
    await runHardwarePass(now);

    const res = await app.inject({ method: 'GET', url: `/api/v1/hardware/hosts?projectId=${s.projectId}`, headers: auth(s.memberToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as HardwareHostListResponse;
    expect(body.hosts).toHaveLength(1);
    const h = body.hosts[0];
    expect(h).toMatchObject({
      id: s.hostId,
      hostName: 'srv-1',
      projectId: s.projectId,
      status: 'critical',
      isVirtual: false,
      muted: false,
      info: { vendor: 'Supermicro', model: 'X11', kernel: '6.1.0', agentVersion: '1.7.0' },
    });
    expect(h.components.cpu).toBe('critical');
    expect(Object.keys(h.components).sort()).toEqual(['cooling', 'cpu', 'disks', 'memory', 'network', 'power']);
    expect(h.findingsCount).toBeGreaterThan(0);
    expect(typeof h.statusChangedAt).toBe('string');
    expect(typeof h.lastSeenAt).toBe('string');
  });

  it('a never evaluated host has a full unknown summary', async () => {
    const s = await setup();
    const res = await app.inject({ method: 'GET', url: `/api/v1/hardware/hosts?projectId=${s.projectId}`, headers: auth(s.ownerToken) });
    const h = (res.json() as HardwareHostListResponse).hosts[0];
    expect(h.status).toBe('unknown');
    expect(Object.values(h.components).every((c) => c === 'unknown')).toBe(true);
    expect(h.info).toEqual({ vendor: null, model: null, kernel: null, agentVersion: null });
  });

  it('validates projectId and hides projects of other organizations', async () => {
    const s = await setup();
    const other = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/v1/hardware/hosts', headers: auth(s.ownerToken) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/hardware/hosts?projectId=nope', headers: auth(s.ownerToken) })).statusCode).toBe(400);
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/hardware/hosts?projectId=${other.projectId}`, headers: auth(s.ownerToken) });
    expect(foreign.statusCode).toBe(404);
  });

  it('returns the detail with snapshot, findings and 7 day series', async () => {
    const s = await setup();
    const now = new Date();
    const memErr = (v: number, type: string): HwPoint => ({ name: 'hw.memory.errors', value: v, hwType: 'memory', hwId: 'mc0', attrs: { error_type: type, scope: 'controller' } });
    const ingest = (points: HwPoint[], t: Date) =>
      metricsService.ingestMetrics(hwRecords(points, 'srv-1', t, s.projectId, s.orgId), s.projectId, s.orgId);
    await ingest([memErr(1, 'corrected'), memErr(0, 'uncorrected')], new Date(now.getTime() - 3 * 60 * MIN));
    await ingest([...healthyPoints().filter((p) => p.name !== 'hw.memory.errors'), memErr(7, 'corrected'), memErr(0, 'uncorrected')], new Date(now.getTime() - 30_000));
    await runHardwarePass(now);

    const res = await app.inject({ method: 'GET', url: `/api/v1/hardware/hosts/${s.hostId}`, headers: auth(s.memberToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as HardwareHostDetailResponse;
    expect(body.host).toMatchObject({ id: s.hostId, status: 'warning' });
    expect(typeof body.host.firstSeenAt).toBe('string');
    expect(typeof body.host.lastEvaluatedAt).toBe('string');
    expect(body.host.snapshot.memory.controllers.length).toBeGreaterThan(0);
    expect(body.host.findings.map((f) => f.code)).toContain('memory.corrected');
    expect(body.host.collectors).toEqual([{ collector: 'smart', ok: true }]);

    const corrected = body.series.find((x) => x.key === 'memory.corrected:mc0');
    expect(corrected).toMatchObject({ component: 'memory', metric: 'hw.memory.errors', hwId: 'mc0' });
    expect(corrected!.points.length).toBeGreaterThanOrEqual(2);
    expect(corrected!.points.at(-1)!.value).toBe(7);
    expect(body.series.find((x) => x.key === 'temperature.max:cpu')).toBeDefined();
    expect(body.series.length).toBeLessThanOrEqual(30);
  });

  it('returns 404 for a host of another organization and for bad ids', async () => {
    const s = await setup();
    const other = await setup();
    for (const url of [
      `/api/v1/hardware/hosts/${other.hostId}`,
      `/api/v1/hardware/hosts/${other.hostId}/events`,
      '/api/v1/hardware/hosts/not-a-uuid',
    ]) {
      expect((await app.inject({ method: 'GET', url, headers: auth(s.ownerToken) })).statusCode).toBe(404);
    }
    expect(
      (await app.inject({ method: 'PATCH', url: `/api/v1/hardware/hosts/${other.hostId}`, headers: auth(s.ownerToken), payload: { muted: true } })).statusCode
    ).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/hardware/hosts/${other.hostId}`, headers: auth(s.ownerToken) })).statusCode).toBe(404);
    const row = await db.selectFrom('hardware_hosts').select('muted').where('id', '=', other.hostId).where('organization_id', '=', other.orgId).executeTakeFirstOrThrow();
    expect(row.muted).toBe(false);
  });

  it('lists hardware events of the host (service hardware, same hostname), newest first, with a limit', async () => {
    const s = await setup();
    const key = await createTestApiKey({ projectId: s.projectId });
    const now = Date.now();
    const ev = (msg: string, ago: number, hostname: string, service = 'hardware') => ({
      time: new Date(now - ago).toISOString(),
      service,
      level: 'error',
      message: msg,
      hostname,
      metadata: { 'hw.event.source': 'kmsg', 'hw.event.type': 'disk', 'host.name': hostname, hostname },
    });
    const ingest = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest',
      headers: { 'x-api-key': key.plainKey, 'content-type': 'application/json' },
      payload: {
        logs: [
          ev('ata1.00: failed command: READ FPDMA QUEUED', 2 * MIN, 'srv-1'),
          ev('EDAC MC0: 1 CE memory read error', MIN, 'srv-1'),
          ev('other host event', MIN, 'srv-2'),
          ev('app log', MIN, 'srv-1', 'api'),
          ev('too old', 8 * 24 * 60 * MIN, 'srv-1'),
        ],
      },
    });
    expect(ingest.statusCode).toBeLessThan(300);

    const res = await app.inject({ method: 'GET', url: `/api/v1/hardware/hosts/${s.hostId}/events`, headers: auth(s.memberToken) });
    expect(res.statusCode).toBe(200);
    const { events } = res.json() as HardwareEventsResponse;
    expect(events.map((e) => e.message)).toEqual(['EDAC MC0: 1 CE memory read error', 'ata1.00: failed command: READ FPDMA QUEUED']);
    expect(events[0]).toMatchObject({ level: 'error', eventType: 'disk', eventSource: 'kmsg' });
    expect(typeof events[0].id).toBe('string');

    const limited = await app.inject({ method: 'GET', url: `/api/v1/hardware/hosts/${s.hostId}/events?limit=1`, headers: auth(s.memberToken) });
    expect((limited.json() as HardwareEventsResponse).events).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: `/api/v1/hardware/hosts/${s.hostId}/events?limit=501`, headers: auth(s.memberToken) })).statusCode).toBe(400);
  });

  it('mute: owners and admins only, returns the summary', async () => {
    const s = await setup();
    const url = `/api/v1/hardware/hosts/${s.hostId}`;
    const asMember = await app.inject({ method: 'PATCH', url, headers: auth(s.memberToken), payload: { muted: true } });
    expect(asMember.statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url, headers: auth(s.adminToken), payload: { muted: 'yes' } })).statusCode).toBe(400);

    const asAdmin = await app.inject({ method: 'PATCH', url, headers: auth(s.adminToken), payload: { muted: true } });
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json().host).toMatchObject({ id: s.hostId, muted: true });
    const asOwner = await app.inject({ method: 'PATCH', url, headers: auth(s.ownerToken), payload: { muted: false } });
    expect(asOwner.json().host.muted).toBe(false);
  });

  it('delete: owners and admins only, resolves the open incident and keeps it', async () => {
    const s = await setup();
    const { incident } = await incidentsService.openOrUpdateFromSource({
      organizationId: s.orgId,
      projectId: s.projectId,
      source: 'hardware',
      sourceId: s.hostId,
      title: 'Hardware critical: srv-1',
      severity: 'critical',
      occurredAt: new Date(),
    });
    const url = `/api/v1/hardware/hosts/${s.hostId}`;
    expect((await app.inject({ method: 'DELETE', url, headers: auth(s.memberToken) })).statusCode).toBe(403);
    const del = await app.inject({ method: 'DELETE', url, headers: auth(s.ownerToken) });
    expect(del.statusCode).toBe(204);

    expect(await db.selectFrom('hardware_hosts').select('id').where('id', '=', s.hostId).where('organization_id', '=', s.orgId).executeTakeFirst()).toBeUndefined();
    const inc = await db.selectFrom('incidents').select(['status', 'hardware_host_id']).where('id', '=', incident.id).where('organization_id', '=', s.orgId).executeTakeFirstOrThrow();
    expect(inc).toEqual({ status: 'resolved', hardware_host_id: null });
    expect((await app.inject({ method: 'GET', url, headers: auth(s.ownerToken) })).statusCode).toBe(404);
  });
});
