import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveConformanceTarget,
  isConformanceRequired,
  probeConformanceTarget,
  createConformanceReservoir,
  resolveSubject,
  ConformanceUnavailableError,
  ConformanceConfigError,
  CONFORMANCE_NAMESPACE_PATTERN,
  TIMESCALE_CONFORMANCE_SCHEMA,
} from './targets.js';

const CLOSED = {
  RESERVOIR_TIMESCALE_URL: 'postgresql://u:secret_pw@127.0.0.1:1/x',
  RESERVOIR_CLICKHOUSE_URL: 'http://default:secret_pw@127.0.0.1:1/x_conformance',
  RESERVOIR_MONGODB_URL: 'mongodb://u:secret_pw@127.0.0.1:1/x_conformance',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveConformanceTarget', () => {
  it('uses defaults', () => {
    expect(resolveConformanceTarget('timescale', {}).config).toMatchObject({ host: 'localhost', port: 5433, database: 'logtide_test', username: 'logtide_test', password: 'test_password', schema: 'reservoir_conformance' });
    expect(resolveConformanceTarget('clickhouse', {})).toMatchObject({ namespace: 'logtide_conformance', config: { port: 18123, username: 'default', password: '' } });
    expect(resolveConformanceTarget('mongodb', {})).toMatchObject({ namespace: 'logtide_conformance', config: { port: 27017 } });
  });

  it('fills every target field', () => {
    expect(resolveConformanceTarget('timescale', {})).toEqual({
      engine: 'timescale',
      namespace: TIMESCALE_CONFORMANCE_SCHEMA,
      redactedUrl: 'postgresql://logtide_test:***@localhost:5433/logtide_test',
      config: { host: 'localhost', port: 5433, database: 'logtide_test', username: 'logtide_test', password: 'test_password', schema: 'reservoir_conformance' },
    });
    expect(resolveConformanceTarget('clickhouse', {})).toEqual({
      engine: 'clickhouse',
      namespace: 'logtide_conformance',
      redactedUrl: 'http://default@localhost:18123/logtide_conformance',
      config: { host: 'localhost', port: 18123, database: 'logtide_conformance', username: 'default', password: '' },
    });
    expect(resolveConformanceTarget('mongodb', {})).toEqual({
      engine: 'mongodb',
      namespace: 'logtide_conformance',
      redactedUrl: 'mongodb://localhost:27017/logtide_conformance',
      config: { host: 'localhost', port: 27017, database: 'logtide_conformance', username: '', password: '' },
    });
  });

  it('reads overrides', () => {
    expect(resolveConformanceTarget('timescale', { RESERVOIR_TIMESCALE_URL: 'postgresql://u:p@db:6000/ux16_rts' }).config).toMatchObject({ host: 'db', port: 6000, database: 'ux16_rts' });
    expect(resolveConformanceTarget('clickhouse', { RESERVOIR_CLICKHOUSE_URL: 'http://default:@localhost:18123/ux16_rch' }).namespace).toBe('ux16_rch');
    expect(resolveConformanceTarget('mongodb', { RESERVOIR_MONGODB_URL: 'mongodb://localhost:27017/ux16_rmg' }).namespace).toBe('ux16_rmg');
  });

  it('decodes credentials and keeps the Timescale schema fixed', () => {
    const ts = resolveConformanceTarget('timescale', { RESERVOIR_TIMESCALE_URL: 'postgres://us%40er:p%2Fw@db/ux16_rts' });
    expect(ts.config).toMatchObject({ username: 'us@er', password: 'p/w', port: 5432, schema: 'reservoir_conformance' });
    expect(ts.namespace).toBe('reservoir_conformance');
    const ch = resolveConformanceTarget('clickhouse', { RESERVOIR_CLICKHOUSE_URL: 'http://localhost/my_conformance_db' });
    expect(ch.config).toMatchObject({ username: 'default', password: '', port: 8123, database: 'my_conformance_db' });
    const mg = resolveConformanceTarget('mongodb', { RESERVOIR_MONGODB_URL: 'mongodb://admin:pw@mongo:27018/ux16_rmg?authSource=admin' });
    expect(mg.config).toMatchObject({ host: 'mongo', port: 27018, username: 'admin', password: 'pw', database: 'ux16_rmg', options: { authSource: 'admin' } });
  });

  it.each([
    ['mongodb', { RESERVOIR_MONGODB_URL: 'mongodb://localhost:27017/logtide_integration_test' }],
    ['clickhouse', { RESERVOIR_CLICKHOUSE_URL: 'http://default:@localhost:18123/logtide_test' }],
    ['clickhouse', { RESERVOIR_CLICKHOUSE_URL: 'http://default:@localhost:18123/logtide' }],
    ['mongodb', { RESERVOIR_MONGODB_URL: 'mongodb://localhost:27017/logtide' }],
    ['mongodb', { RESERVOIR_MONGODB_URL: 'mongodb://localhost:27017/' }],
    ['clickhouse', { RESERVOIR_CLICKHOUSE_URL: 'http://localhost:18123' }],
    ['clickhouse', { RESERVOIR_CLICKHOUSE_URL: 'http://localhost:18123/Conformance' }],
    ['clickhouse', { RESERVOIR_CLICKHOUSE_URL: 'http://localhost:18123/x_conformance;DROP' }],
  ] as const)('refuses to reset shared %s databases (%j)', (engine, env) => expect(() => resolveConformanceTarget(engine, env)).toThrow(ConformanceConfigError));

  it.each([
    ['timescale', { RESERVOIR_TIMESCALE_URL: 'not a url' }],
    ['timescale', { RESERVOIR_TIMESCALE_URL: 'mysql://u:p@localhost:3306/x' }],
    ['timescale', { RESERVOIR_TIMESCALE_URL: 'postgresql://u:p@localhost:5433/' }],
    ['clickhouse', { RESERVOIR_CLICKHOUSE_URL: 'ftp://localhost/x_conformance' }],
    ['mongodb', { RESERVOIR_MONGODB_URL: 'mongodb+srv://cluster.example.com/x_conformance' }],
  ] as const)('rejects malformed %s URLs (%j)', (engine, env) => expect(() => resolveConformanceTarget(engine, env)).toThrow(ConformanceConfigError));

  it('accepts the namespaces of the master plan databases', () => {
    for (const ok of ['logtide_conformance', 'reservoir_conformance', 'conformance', 'ux16_rch', 'ux16_rmg', 'a_conformance_2']) {
      expect(CONFORMANCE_NAMESPACE_PATTERN.test(ok)).toBe(true);
    }
    for (const bad of ['logtide_test', 'logtide_integration_test', 'ux16_', 'UX16_RCH', 'conformance-db', '']) {
      expect(CONFORMANCE_NAMESPACE_PATTERN.test(bad)).toBe(false);
    }
  });

  it('redacts passwords', () => {
    expect(resolveConformanceTarget('timescale', {}).redactedUrl).not.toContain('test_password');
    for (const engine of ['timescale', 'clickhouse', 'mongodb'] as const) {
      expect(resolveConformanceTarget(engine, CLOSED).redactedUrl).not.toContain('secret_pw');
    }
  });

  it('rejects an unknown engine', () => {
    expect(() => resolveConformanceTarget('oracle' as never, {})).toThrow(ConformanceConfigError);
  });
});

describe('probeConformanceTarget', () => {
  it.each(['timescale', 'clickhouse', 'mongodb'] as const)('probe of a closed port is unavailable (%s)', async (engine) => {
    const env = { RESERVOIR_TIMESCALE_URL: 'postgresql://u:p@127.0.0.1:1/x', RESERVOIR_CLICKHOUSE_URL: 'http://default:@127.0.0.1:1/x_conformance', RESERVOIR_MONGODB_URL: 'mongodb://127.0.0.1:1/x_conformance' };
    await expect(probeConformanceTarget(resolveConformanceTarget(engine, env), 500)).rejects.toBeInstanceOf(ConformanceUnavailableError);
  }, 10_000);

  it.each(['timescale', 'clickhouse', 'mongodb'] as const)('the unavailable error names the redacted URL (%s)', async (engine) => {
    const target = resolveConformanceTarget(engine, CLOSED);
    const err = await probeConformanceTarget(target, 500).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(ConformanceUnavailableError);
    expect((err as ConformanceUnavailableError).url).toBe(target.redactedUrl);
    expect((err as Error).message).toContain(target.redactedUrl);
    expect((err as Error).message).not.toContain('secret_pw');
  }, 10_000);
});

describe('createConformanceReservoir', () => {
  it.each(['timescale', 'clickhouse', 'mongodb'] as const)('rejects as unavailable before touching anything (%s)', async (engine) => {
    await expect(createConformanceReservoir(engine, CLOSED, { probeTimeoutMs: 500 })).rejects.toBeInstanceOf(ConformanceUnavailableError);
  }, 10_000);

  it('propagates configuration errors unchanged', async () => {
    await expect(createConformanceReservoir('mongodb', { RESERVOIR_MONGODB_URL: 'mongodb://localhost:27017/logtide_test' })).rejects.toBeInstanceOf(ConformanceConfigError);
  });
});

describe('resolveSubject', () => {
  it('resolveSubject skips, fails loudly, or rethrows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unavailable = () => Promise.reject(new ConformanceUnavailableError('down'));
    await expect(resolveSubject('clickhouse', unavailable, false)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith('Reservoir conformance skipped for clickhouse: down. Set RESERVOIR_CONFORMANCE_REQUIRED=1 to make this a failure.');
    await expect(resolveSubject('clickhouse', unavailable, true)).rejects.toThrow('Reservoir conformance required but clickhouse is unreachable: down');
    await expect(resolveSubject('clickhouse', () => Promise.reject(new Error('boom')), false)).rejects.toThrow('boom');
    await expect(resolveSubject('clickhouse', () => Promise.reject(new ConformanceConfigError('bad db')), false)).rejects.toBeInstanceOf(ConformanceConfigError);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('returns the created subject', async () => {
    const subject = { ok: true };
    await expect(resolveSubject('mongodb', () => Promise.resolve(subject), true)).resolves.toBe(subject);
  });
});

it('isConformanceRequired', () => {
  expect(isConformanceRequired({ RESERVOIR_CONFORMANCE_REQUIRED: '1' })).toBe(true);
  expect(isConformanceRequired({})).toBe(false);
  expect(isConformanceRequired({ RESERVOIR_CONFORMANCE_REQUIRED: 'true' })).toBe(false);
  expect(isConformanceRequired({ RESERVOIR_CONFORMANCE_REQUIRED: '0' })).toBe(false);
});

it('error classes carry their names', () => {
  const unavailable = new ConformanceUnavailableError('x', { url: 'u' });
  expect(unavailable).toBeInstanceOf(Error);
  expect(unavailable.name).toBe('ConformanceUnavailableError');
  expect(unavailable.url).toBe('u');
  expect(new ConformanceConfigError('y').name).toBe('ConformanceConfigError');
});
