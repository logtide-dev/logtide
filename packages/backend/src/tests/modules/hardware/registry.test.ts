import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import { build } from '../../../server.js';
import { createTestApiKey, createTestContext } from '../../helpers/index.js';
import {
  REGISTRATION_THROTTLE_MAX_ENTRIES,
  hardwareHostNames,
  hardwareRegistrationThrottleSize,
  registerHardwareHosts,
  resetHardwareRegistrationThrottle,
} from '../../../modules/hardware/registry.js';
import { eventually, getHostRow, healthyPoints, hwOtlpBody, hwRecords } from './helpers.js';

describe('hardware host registry', () => {
  let app: any;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetHardwareRegistrationThrottle();
  });

  it('registers the host of an hw.* OTLP batch through the real ingest path', async () => {
    const key = await createTestApiKey({ name: 'hw agent' });
    const res = await request(app.server)
      .post('/v1/otlp/metrics')
      .set('x-api-key', key.plainKey)
      .set('Content-Type', 'application/json')
      .send(hwOtlpBody(healthyPoints(), 'srv-otlp'))
      .expect(200);
    expect(res.body.partialSuccess.rejectedDataPoints).toBe(0);

    const row = await eventually(() => getHostRow(key.project_id, 'srv-otlp'));
    expect(row.status).toBe('unknown');
    expect(row.last_seen_at).toBeInstanceOf(Date);
    expect(Date.now() - row.last_seen_at!.getTime()).toBeLessThan(60_000);
  });

  it('ignores batches without hw.* metrics', async () => {
    const key = await createTestApiKey({ name: 'app' });
    const body = hwOtlpBody([{ name: 'cpu.usage', value: 1, hwType: 'x', hwId: 'x' }], 'srv-app');
    await request(app.server)
      .post('/v1/otlp/metrics')
      .set('x-api-key', key.plainKey)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(await getHostRow(key.project_id, 'srv-app')).toBeUndefined();
  });

  it('extracts distinct host names, falling back to the resource attribute', () => {
    expect(
      hardwareHostNames([
        { metricName: 'hw.temperature', attributes: { 'host.name': 'a' } },
        { metricName: 'hw.fan.speed', attributes: { 'host.name': 'a' } },
        { metricName: 'hw.voltage', attributes: {}, resourceAttributes: { 'host.name': 'b' } },
        { metricName: 'cpu.usage', attributes: { 'host.name': 'c' } },
        { metricName: 'hw.voltage', attributes: { 'host.name': '   ' } },
        { metricName: 'hw.voltage', attributes: { 'host.name': 'x'.repeat(256) } },
      ]).sort()
    ).toEqual(['a', 'b']);
  });

  it('throttles upserts per project and host for 60 s', async () => {
    const ctx = await createTestContext();
    const records = hwRecords(healthyPoints(), 'srv-t', new Date(), ctx.project.id, ctx.organization.id);
    const t0 = new Date('2026-11-10T10:00:00.000Z');

    expect(await registerHardwareHosts(records, ctx.project.id, ctx.organization.id, t0)).toEqual(['srv-t']);
    expect(await registerHardwareHosts(records, ctx.project.id, ctx.organization.id, new Date(t0.getTime() + 30_000))).toEqual([]);
    const later = new Date(t0.getTime() + 61_000);
    expect(await registerHardwareHosts(records, ctx.project.id, ctx.organization.id, later)).toEqual(['srv-t']);

    const row = await getHostRow(ctx.project.id, 'srv-t');
    expect(row!.last_seen_at!.getTime()).toBe(later.getTime());
    expect(row!.first_seen_at.getTime()).toBe(t0.getTime());
  });

  it('never moves last_seen_at backwards', async () => {
    const ctx = await createTestContext();
    const records = hwRecords(healthyPoints(), 'srv-b', new Date(), ctx.project.id, ctx.organization.id);
    const t0 = new Date('2026-11-10T10:00:00.000Z');
    await registerHardwareHosts(records, ctx.project.id, ctx.organization.id, t0);
    resetHardwareRegistrationThrottle();
    await registerHardwareHosts(records, ctx.project.id, ctx.organization.id, new Date(t0.getTime() - 3_600_000));
    expect((await getHostRow(ctx.project.id, 'srv-b'))!.last_seen_at!.getTime()).toBe(t0.getTime());
  });

  it('never throws and retries the next batch after a failure', async () => {
    const ctx = await createTestContext();
    const records = hwRecords(healthyPoints(), 'srv-f', new Date(), ctx.project.id, ctx.organization.id);
    // Unknown organization: FK violation.
    await expect(registerHardwareHosts(records, ctx.project.id, crypto.randomUUID())).resolves.toEqual([]);
    // Not throttled after the failure.
    expect(await registerHardwareHosts(records, ctx.project.id, ctx.organization.id)).toEqual(['srv-f']);
  });

  it('keeps the throttle map bounded', async () => {
    const ctx = await createTestContext();
    const now = new Date();
    const many = Array.from({ length: REGISTRATION_THROTTLE_MAX_ENTRIES + 50 }, (_, i) => ({
      metricName: 'hw.host.info',
      attributes: { 'host.name': `h-${i}` },
    }));
    // One big batch: the map must not exceed its bound.
    await registerHardwareHosts(many, ctx.project.id, ctx.organization.id, now);
    expect(hardwareRegistrationThrottleSize()).toBeLessThanOrEqual(REGISTRATION_THROTTLE_MAX_ENTRIES);
  });
});
