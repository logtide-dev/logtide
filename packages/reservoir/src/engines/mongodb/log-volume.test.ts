import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient } from 'mongodb';
import { MongoDBEngine } from './mongodb-engine.js';
import type { MongoLogVolume } from './log-volume.js';
import { zeroFillHistogram } from '../../core/aggregation-helpers.js';
import type { LogLevel, LogRecord, StorageConfig } from '../../core/types.js';

const CONFIG: StorageConfig = { host: 'localhost', port: 27017, database: 'logtide_volume_test', username: '', password: '' };
const MIN = 60_000;
const HOUR = 60 * MIN;
const P1 = 'proj-volume-1';
const P2 = 'proj-volume-2';

interface Kept { time: Date; projectId: string; level: LogLevel; service: string }

describe('MongoDB log volume aggregate (integration)', () => {
  let engine: MongoDBEngine;
  let client: MongoClient;
  let available = false;
  /** What the logs collection holds, to compute the expected numbers independently. */
  let kept: Kept[] = [];
  const now = Date.now();
  const anchor = Math.floor((now - 3 * HOUR) / MIN) * MIN;

  const volume = (): MongoLogVolume => (engine as unknown as { logVolume(): MongoLogVolume }).logVolume();
  const db = () => client.db(CONFIG.database);

  beforeAll(async () => {
    client = new MongoClient(`mongodb://${CONFIG.host}:${CONFIG.port}`, { serverSelectionTimeoutMS: 3000 });
    try {
      await client.connect();
      await client.db(CONFIG.database).dropDatabase();
    } catch {
      console.warn('MongoDB not available at localhost:27017 - skipping log volume tests');
      return;
    }
    engine = new MongoDBEngine(CONFIG, { tableName: 'logs', skipInitialize: false });
    await engine.connect();
    await engine.initialize();
    available = true;
  }, 30_000);

  afterAll(async () => {
    if (!available) return;
    await db().dropDatabase().catch(() => undefined);
    await engine.disconnect();
    await client.close();
  });

  beforeEach(async ({ skip }) => {
    if (!available) skip();
    for (const name of ['logs', 'log_volume_minutes', 'log_volume_state', 'log_volume_dirty']) {
      await db().collection(name).deleteMany({});
    }
    kept = [];
    const levels: LogLevel[] = ['info', 'info', 'warn', 'error', 'debug'];
    const services = ['api', 'worker', 'cron'];
    const logs: LogRecord[] = [];
    for (let i = 0; i < 300; i++) {
      logs.push(log(i % 4 === 0 ? P2 : P1, new Date(anchor + i * 33_331), levels[i % 5], services[i % 3]));
    }
    for (let i = 0; i < 15; i++) logs.push(log(P1, new Date(now - i * 11_000), 'info', 'api'));
    await ingest(logs);
  });

  function log(projectId: string, time: Date, level: LogLevel, service: string): LogRecord {
    return { projectId, time, level, service, message: 'm', metadata: {} };
  }

  async function ingest(logs: LogRecord[]) {
    const result = await engine.ingest(logs);
    expect(result.failed).toBe(0);
    kept.push(...logs.map((l) => ({ time: l.time, projectId: l.projectId, level: l.level, service: l.service })));
  }

  type Scope = { projectId: string | string[]; from: Date; to: Date; level?: LogLevel[]; service?: string[]; exclude?: { level?: LogLevel[] } };
  const inScope = (k: Kept, s: Scope) =>
    (Array.isArray(s.projectId) ? s.projectId : [s.projectId]).includes(k.projectId) &&
    k.time >= s.from && k.time <= s.to &&
    (!s.level || s.level.includes(k.level)) &&
    (!s.service || s.service.includes(k.service)) &&
    !(s.exclude?.level ?? []).includes(k.level);

  const scopes = (): Scope[] => [
    { projectId: P1, from: new Date(anchor - 17_000), to: new Date(now) },
    { projectId: [P1, P2], from: new Date(anchor + 7_500), to: new Date(anchor + 2 * HOUR + 41_000) },
    { projectId: P1, from: new Date(anchor), to: new Date(now), level: ['error', 'warn'], service: ['api', 'worker'] },
    { projectId: P2, from: new Date(anchor), to: new Date(now), exclude: { level: ['debug'] } },
  ];

  async function expectExact() {
    for (const s of scopes()) {
      const expectedCount = kept.filter((k) => inScope(k, s)).length;
      expect((await engine.count(s)).count).toBe(expectedCount);
      const expected = zeroFillHistogram(
        { from: s.from, to: s.to, bucketSeconds: 900 },
        kept.filter((k) => inScope(k, s)).map((k) => ({ time: new Date(Math.floor(k.time.getTime() / 900_000) * 900_000), level: k.level, count: 1 })),
      );
      expect(await engine.histogram({ ...s, bucketSeconds: 900 })).toEqual(expected);
    }
  }

  it('matches the logs before the first refresh (nothing materialized)', async () => {
    expect(await volume().watermark()).toBeNull();
    await expectExact();
  });

  it('materializes up to five minutes ago and still matches', async () => {
    const result = await volume().refresh();
    expect(result.ran).toBe(true);
    expect(result.watermark!.getTime()).toBeGreaterThan(now - 6 * MIN);
    expect(await db().collection('log_volume_minutes').countDocuments()).toBeGreaterThan(0);
    await expectExact();
  });

  it('reads the counts for materialized minutes', async () => {
    await volume().refresh();
    // Delete logs behind the engine's back: the counts still have them, which
    // proves the materialized minutes are not read from the logs.
    const from = new Date(anchor + HOUR);
    const to = new Date(anchor + 2 * HOUR);
    const before = (await engine.count({ projectId: P1, from, to, toExclusive: true })).count;
    await db().collection('logs').deleteMany({ project_id: P1, time: { $gte: from, $lt: to } });
    expect(before).toBeGreaterThan(0);
    expect((await engine.count({ projectId: P1, from, to, toExclusive: true })).count).toBe(before);
  });

  it('late logs count at once and are folded in by the next refresh', async () => {
    await volume().refresh();
    await ingest(Array.from({ length: 9 }, (_, i) => log(P1, new Date(anchor + 30 * MIN + i * 7_777), 'critical', 'api')));
    expect(await db().collection('log_volume_dirty').countDocuments()).toBe(1);
    await expectExact();
    const result = await volume().refresh();
    expect(result.recomputedSpans).toBe(1);
    expect(await db().collection('log_volume_dirty').countDocuments()).toBe(0);
    await expectExact();
  });

  it('deletes count at once and are folded in by the next refresh', async () => {
    await volume().refresh();
    const from = new Date(anchor + 20 * MIN + 13_000);
    const to = new Date(anchor + 75 * MIN);
    await engine.deleteByTimeRange({ projectId: P1, from, to });
    kept = kept.filter((k) => !(k.projectId === P1 && k.time >= from && k.time <= to));
    await expectExact();
    await volume().refresh();
    expect(await db().collection('log_volume_dirty').countDocuments()).toBe(0);
    await expectExact();
  });

  it('a project purge marks only materialized minutes and leaves nothing behind after the refresh', async () => {
    await volume().refresh();
    await engine.deleteByTimeRange({ projectId: P2, from: new Date(0), to: new Date('2100-01-01T00:00:00Z') });
    kept = kept.filter((k) => k.projectId !== P2);
    const dirty = await db().collection('log_volume_dirty').find({}).toArray();
    expect(dirty).toHaveLength(1);
    expect(dirty[0].to.getTime()).toBeLessThanOrEqual((await volume().watermark())!.getTime());
    await expectExact();
    await volume().refresh();
    expect(await db().collection('log_volume_dirty').countDocuments()).toBe(0);
    expect(await db().collection('log_volume_minutes').countDocuments({ p: P2 })).toBe(0);
    await expectExact();
  });

  it('a delete above the watermark marks nothing', async () => {
    await volume().refresh();
    await engine.deleteByTimeRange({ projectId: P1, from: new Date(now - MIN), to: new Date(now + MIN) });
    kept = kept.filter((k) => !(k.projectId === P1 && k.time >= new Date(now - MIN) && k.time <= new Date(now + MIN)));
    expect(await db().collection('log_volume_dirty').countDocuments()).toBe(0);
    await expectExact();
  });

  it('a watermark moved between the checks and the insert is caught after the insert', async () => {
    await volume().refresh(now);
    // Logs three minutes old: above the watermark (five minutes back) when the writer checks.
    const logs = Array.from({ length: 5 }, (_, i) => log(P1, new Date(now - 3 * MIN + i * 1_000), 'error', 'api'));
    const seen = await volume().beforeInsert(logs.map((l) => ({ projectId: l.projectId, time: l.time })));
    expect(seen).not.toBeNull();
    // A refresher four minutes later materializes those minutes without the
    // logs, which are not written yet.
    await volume().refresh(now + 4 * MIN);
    await db().collection('logs').insertMany(logs.map((l) => ({ time: l.time, project_id: l.projectId, level: l.level, service: l.service, message: 'm', metadata: {} })));
    kept.push(...logs.map((l) => ({ time: l.time, projectId: l.projectId, level: l.level, service: l.service })));
    await volume().afterInsert(logs.map((l) => ({ projectId: l.projectId, time: l.time })), seen);
    await expectExact();
  });

  it('runs one refresher at a time', async () => {
    const results = await Promise.all([volume().refresh(), volume().refresh(), volume().refresh()]);
    expect(results.filter((r) => r.ran)).toHaveLength(1);
    await expectExact();
  });

  it('real-time batches never read the volume state', async () => {
    await volume().refresh();
    const state = db().collection('log_volume_state');
    const before = await state.findOne({ _id: 'logs' as never });
    await state.updateOne({ _id: 'logs' as never }, { $set: { watermark: new Date(8.64e15) } });
    // A batch of fresh logs: no dirty span even with a watermark in the far future.
    await ingest([log(P1, new Date(), 'info', 'api')]);
    expect(await db().collection('log_volume_dirty').countDocuments()).toBe(0);
    await state.updateOne({ _id: 'logs' as never }, { $set: { watermark: before!.watermark } });
  });
});
