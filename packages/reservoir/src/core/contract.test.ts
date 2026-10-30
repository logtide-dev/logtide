import { describe, it, expect, vi } from 'vitest';
import { StorageEngine } from './storage-engine.js';
import { NotImplementedError } from './errors.js';
import type { StorageConfig } from './types.js';
import { ReservoirBuffered } from '../buffered/reservoir-buffered.js';
import { InMemoryTransport } from '../buffered/transports/in-memory.js';
import { DEFAULT_BREAKER, DEFAULT_FLUSH, DEFAULT_RETRY } from '../buffered/types.js';
import { Reservoir } from '../client.js';

const config: StorageConfig = {
  host: 'localhost',
  port: 5432,
  database: 'test',
  username: 'test',
  password: 'test',
};

const NEW = [
  'histogram',
  'facets',
  'discoverMetadataKeys',
  'getOperationStats',
  'getLatencyHistogram',
  'listSessions',
  'hasSessions',
] as const;

describe('StorageEngine 1.6 defaults', () => {
  it.each(NEW)('StorageEngine.%s rejects with NotImplementedError by default', async (method) => {
    const Engine = StorageEngine as unknown as new (c: StorageConfig) => StorageEngine; // abstract only at type level
    const err = await (new Engine(config) as any)[method]({}).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(NotImplementedError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NotImplementedError');
    expect(err.method).toBe(method);
    expect(err.message).toBe(`${method} is not implemented by StorageEngine`);
  });

  it.each(NEW)('a subclass that does not override %s names itself in the error', async (method) => {
    class PartialEngine extends (StorageEngine as unknown as new (c: StorageConfig) => object) {}
    const err = await (new PartialEngine(config) as any)[method]({}).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(NotImplementedError);
    expect(err.message).toBe(`${method} is not implemented by PartialEngine`);
  });
});

describe('ReservoirBuffered 1.6 delegations', () => {
  it.each(NEW)('ReservoirBuffered delegates %s to the inner reservoir', async (method) => {
    const engine = {
      ingest: vi.fn(),
      ingestSpans: vi.fn(),
      ingestMetrics: vi.fn(),
    };
    const inner = {
      getEngine: vi.fn().mockReturnValue(engine),
      [method]: vi.fn().mockResolvedValue('x'),
    } as unknown as Reservoir;
    const buffered = new ReservoirBuffered(inner, {
      transport: new InMemoryTransport({ shards: 1 }),
      flush: DEFAULT_FLUSH,
      circuitBreaker: DEFAULT_BREAKER,
      retry: DEFAULT_RETRY,
    });
    const params = { projectId: 'p', from: new Date(0), to: new Date(1) };
    expect(await (buffered as any)[method](params)).toBe('x');
    expect((inner as any)[method]).toHaveBeenCalledWith(params);
  });
});

describe('Reservoir 1.6 methods', () => {
  it.each(NEW)('Reservoir.%s forwards to the engine once initialized', async (method) => {
    const r = new Reservoir('timescale', config) as any;
    const engineMethod = vi.fn().mockResolvedValue('ok');
    r.initialized = true;
    r.engine = { [method]: engineMethod };
    const params = method === 'histogram'
      ? { projectId: 'p', from: new Date(0), to: new Date(60_000), bucketSeconds: 60 }
      : method === 'facets'
        ? { projectId: 'p', from: new Date(0), to: new Date(1), fields: [{ builtin: 'level' }] }
        : method === 'listSessions'
          ? { projectId: 'p', from: new Date(0), to: new Date(1), limit: 10 }
          : { projectId: 'p', from: new Date(0), to: new Date(1) };
    expect(await r[method](params)).toBe('ok');
    expect(engineMethod).toHaveBeenCalledOnce();
    expect(engineMethod.mock.calls[0][0]).toMatchObject({ projectId: 'p' });
  });

  it.each(NEW)('Reservoir.%s throws before initialization', async (method) => {
    await expect((new Reservoir('timescale', config) as any)[method]({})).rejects.toThrow('Reservoir not initialized');
  });
});

it('exports the contract values from the package index', async () => {
  const r = await import('../index.js');
  expect(r.LATENCY_HISTOGRAM_BOUNDS_MS).toEqual([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000]);
  expect(r.DEFAULT_OPERATION_KINDS).toEqual(['SERVER', 'CONSUMER']);
  expect(r.MAX_HISTOGRAM_BUCKETS).toBe(1000);
  expect(r.SESSIONS_MAX_LIMIT).toBe(200);
  expect(r.FACETS_DEFAULT_LIMIT).toBe(10);
  expect(r.FACETS_MAX_LIMIT).toBe(50);
  expect(r.FACETS_MAX_FIELDS).toBe(20);
  expect(r.DISCOVER_DEFAULT_SAMPLE_SIZE).toBe(1000);
  expect(r.DISCOVER_MAX_SAMPLE_SIZE).toBe(5000);
  expect(r.DISCOVER_MAX_KEYS).toBe(500);
  expect(r.OPERATION_STATS_DEFAULT_LIMIT).toBe(100);
  expect(r.OPERATION_STATS_MAX_LIMIT).toBe(500);
  expect(typeof r.NotImplementedError).toBe('function');
});

it('contract constants cannot be mutated by callers', async () => {
  const r = await import('../index.js');
  expect(Object.isFrozen(r.LATENCY_HISTOGRAM_BOUNDS_MS)).toBe(true);
  expect(Object.isFrozen(r.DEFAULT_OPERATION_KINDS)).toBe(true);
});
