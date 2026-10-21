// ============================================================================
// Conformance targets: env-driven engine connections, probes, namespace reset
// ============================================================================
// Each engine runs the conformance suite against its own namespace, which is
// dropped and recreated per run: the Timescale schema `reservoir_conformance`,
// or a ClickHouse / MongoDB database whose name matches
// CONFORMANCE_NAMESPACE_PATTERN (so shared test databases are never reset).
// An unreachable server is a skip unless RESERVOIR_CONFORMANCE_REQUIRED=1.

import pg from 'pg';
import { createClient } from '@clickhouse/client';
import { MongoClient } from 'mongodb';
import { Reservoir } from '../client.js';
import type { StorageEngine } from '../core/storage-engine.js';
import type { EngineType, StorageConfig } from '../core/types.js';
import { TimescaleEngine } from '../engines/timescale/timescale-engine.js';
import { ClickHouseEngine } from '../engines/clickhouse/clickhouse-engine.js';
import { MongoDBEngine } from '../engines/mongodb/mongodb-engine.js';

export interface ConformanceTarget {
  engine: EngineType;
  config: StorageConfig;
  /** Timescale schema, or ClickHouse / MongoDB database, reset per run. */
  namespace: string;
  /** The connection URL with the password replaced by `***`. */
  redactedUrl: string;
}

/** The server could not be reached (skip, or fail when conformance is required). */
export class ConformanceUnavailableError extends Error {
  readonly url?: string;

  constructor(message: string, options: { url?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ConformanceUnavailableError';
    this.url = options.url;
  }
}

/** The target configuration is invalid or would reset a shared database. */
export class ConformanceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConformanceConfigError';
  }
}

export const TIMESCALE_CONFORMANCE_SCHEMA = 'reservoir_conformance';

/**
 * ClickHouse / MongoDB database names the suite may drop. `logtide_test` and
 * `logtide_integration_test` never match: other test files truncate or drop
 * them while Vitest runs files in parallel.
 */
export const CONFORMANCE_NAMESPACE_PATTERN = /^(?:[a-z0-9_]*conformance[a-z0-9_]*|ux16_[a-z0-9_]+)$/;

export const CONFORMANCE_ENV = {
  timescale: 'RESERVOIR_TIMESCALE_URL',
  clickhouse: 'RESERVOIR_CLICKHOUSE_URL',
  mongodb: 'RESERVOIR_MONGODB_URL',
} as const satisfies Record<EngineType, string>;

export const CONFORMANCE_DEFAULT_URLS = {
  timescale: 'postgresql://logtide_test:test_password@localhost:5433/logtide_test',
  clickhouse: 'http://default:@localhost:18123/logtide_conformance',
  mongodb: 'mongodb://localhost:27017/logtide_conformance',
} as const satisfies Record<EngineType, string>;

const PROTOCOLS: Record<EngineType, readonly string[]> = {
  timescale: ['postgresql:', 'postgres:'],
  clickhouse: ['http:'],
  mongodb: ['mongodb:'],
};

const DEFAULT_PORTS: Record<EngineType, number> = { timescale: 5432, clickhouse: 8123, mongodb: 27017 };

function redact(url: URL): string {
  const copy = new URL(url.href);
  if (copy.password) copy.password = '***';
  return copy.href;
}

function decode(part: string, what: string, raw: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new ConformanceConfigError(`Invalid ${what} in ${raw}`);
  }
}

/** Resolves the connection of one engine from the environment (defaults in CONFORMANCE_DEFAULT_URLS). */
export function resolveConformanceTarget(engine: EngineType, env: NodeJS.ProcessEnv = process.env): ConformanceTarget {
  if (!Object.prototype.hasOwnProperty.call(CONFORMANCE_ENV, engine)) {
    throw new ConformanceConfigError(`Unknown conformance engine ${String(engine)}`);
  }
  const variable = CONFORMANCE_ENV[engine];
  const raw = env[variable] || CONFORMANCE_DEFAULT_URLS[engine];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConformanceConfigError(`${variable} is not a valid URL`);
  }
  if (!PROTOCOLS[engine].includes(url.protocol)) {
    throw new ConformanceConfigError(`${variable} must use ${PROTOCOLS[engine].map((p) => `${p}//`).join(' or ')} (got ${url.protocol}//)`);
  }
  const redactedUrl = redact(url);
  if (!url.hostname) throw new ConformanceConfigError(`${variable} needs a host (${redactedUrl})`);
  const port = url.port ? Number(url.port) : DEFAULT_PORTS[engine];
  const database = decode(url.pathname.replace(/^\//, ''), 'database name', redactedUrl);
  if (!database) throw new ConformanceConfigError(`${variable} needs a database name (${redactedUrl})`);
  let username = decode(url.username, 'username', redactedUrl);
  const password = decode(url.password, 'password', redactedUrl);

  if (engine === 'timescale') {
    return {
      engine,
      namespace: TIMESCALE_CONFORMANCE_SCHEMA,
      redactedUrl,
      config: { host: url.hostname, port, database, username, password, schema: TIMESCALE_CONFORMANCE_SCHEMA },
    };
  }

  if (!CONFORMANCE_NAMESPACE_PATTERN.test(database)) {
    throw new ConformanceConfigError(
      `Refusing to reset the ${engine} database "${database}" (${variable}): the conformance suite drops it, so its name must match ${String(CONFORMANCE_NAMESPACE_PATTERN)}`,
    );
  }
  if (engine === 'clickhouse' && username === '') username = 'default';
  const config: StorageConfig = { host: url.hostname, port, database, username, password };
  if (engine === 'mongodb' && url.search) {
    config.options = Object.fromEntries(url.searchParams.entries());
  }
  return { engine, namespace: database, redactedUrl, config };
}

export function isConformanceRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RESERVOIR_CONFORMANCE_REQUIRED === '1';
}

/**
 * Engines listed in RESERVOIR_CONFORMANCE_ENGINES (comma separated, spaces
 * ignored, duplicates dropped, order kept). An unknown name throws, so a typo
 * fails at collection instead of silently running nothing.
 */
export function parseConformanceEngines(env: NodeJS.ProcessEnv = process.env): EngineType[] {
  const engines: EngineType[] = [];
  for (const raw of (env.RESERVOIR_CONFORMANCE_ENGINES ?? '').split(',')) {
    const name = raw.trim();
    if (name === '') continue;
    if (!Object.prototype.hasOwnProperty.call(CONFORMANCE_ENV, name)) {
      throw new ConformanceConfigError(
        `Unknown engine "${name}" in RESERVOIR_CONFORMANCE_ENGINES (use ${Object.keys(CONFORMANCE_ENV).join(', ')})`,
      );
    }
    if (!engines.includes(name as EngineType)) engines.push(name as EngineType);
  }
  return engines;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms.toLocaleString('en-US')} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function message(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) return err.errors.map(message).join('; ');
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

function mongoUrl(config: StorageConfig): string {
  const auth = config.username
    ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
    : '';
  const query = config.options
    ? `?${new URLSearchParams(Object.entries(config.options).map(([k, v]): [string, string] => [k, String(v)])).toString()}`
    : '';
  return `mongodb://${auth}${config.host}:${config.port}/${query}`;
}

function pgClient(config: StorageConfig, timeoutMs: number): pg.Client {
  const client = new pg.Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    connectionTimeoutMillis: timeoutMs,
  });
  client.on('error', () => undefined);
  return client;
}

function clickHouseClient(config: StorageConfig, timeoutMs: number) {
  return createClient({
    url: `http://${config.host}:${config.port}`,
    username: config.username,
    password: config.password,
    request_timeout: timeoutMs,
  });
}

function mongoClient(config: StorageConfig, timeoutMs: number): MongoClient {
  return new MongoClient(mongoUrl(config), { serverSelectionTimeoutMS: timeoutMs, connectTimeoutMS: timeoutMs });
}

async function runAgainst<C>(
  open: () => C,
  use: (client: C) => Promise<void>,
  close: (client: C) => Promise<void>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const client = open();
  try {
    await withTimeout(use(client), timeoutMs, what);
  } finally {
    // A client whose connection failed may never settle its close promise.
    await withTimeout(close(client), timeoutMs, `closing ${what}`).catch(() => undefined);
  }
}

async function ping(target: ConformanceTarget, timeoutMs: number): Promise<void> {
  const { config } = target;
  const what = `${target.engine} at ${target.redactedUrl}`;
  switch (target.engine) {
    case 'timescale':
      return runAgainst(
        () => pgClient(config, timeoutMs),
        async (c) => {
          await c.connect();
          await c.query('SELECT 1');
        },
        (c) => c.end(),
        timeoutMs,
        what,
      );
    case 'clickhouse':
      // No database here: the suite creates it after the probe.
      return runAgainst(
        () => clickHouseClient(config, timeoutMs),
        async (c) => {
          const rs = await c.query({ query: 'SELECT 1', format: 'JSONEachRow' });
          await rs.json();
        },
        (c) => c.close(),
        timeoutMs,
        what,
      );
    case 'mongodb':
      return runAgainst(
        () => mongoClient(config, timeoutMs),
        async (c) => {
          await c.connect();
          await c.db('admin').command({ ping: 1 });
        },
        (c) => c.close(),
        timeoutMs,
        what,
      );
  }
}

/** Fails with ConformanceUnavailableError (carrying the redacted URL) when the server does not answer. */
export async function probeConformanceTarget(target: ConformanceTarget, timeoutMs = 3000): Promise<void> {
  try {
    await ping(target, timeoutMs);
  } catch (err) {
    throw new ConformanceUnavailableError(`${target.redactedUrl}: ${message(err)}`, { url: target.redactedUrl, cause: err });
  }
}

/** Drops and recreates the target namespace (only names validated by resolveConformanceTarget). */
async function resetNamespace(target: ConformanceTarget, timeoutMs: number): Promise<void> {
  const { config, namespace } = target;
  const what = `resetting ${target.engine} namespace ${namespace}`;
  switch (target.engine) {
    case 'timescale':
      return runAgainst(
        () => pgClient(config, timeoutMs),
        async (c) => {
          await c.connect();
          await c.query(`DROP SCHEMA IF EXISTS ${TIMESCALE_CONFORMANCE_SCHEMA} CASCADE`);
        },
        (c) => c.end(),
        timeoutMs,
        what,
      );
    case 'clickhouse':
      return runAgainst(
        () => clickHouseClient(config, timeoutMs),
        async (c) => {
          await c.command({ query: `DROP DATABASE IF EXISTS ${namespace} SYNC` });
          await c.command({ query: `CREATE DATABASE ${namespace}` });
        },
        (c) => c.close(),
        timeoutMs,
        what,
      );
    case 'mongodb':
      return runAgainst(
        () => mongoClient(config, timeoutMs),
        async (c) => {
          await c.connect();
          await c.db(namespace).dropDatabase();
        },
        (c) => c.close(),
        timeoutMs,
        what,
      );
  }
}

function constructEngine(target: ConformanceTarget): StorageEngine {
  switch (target.engine) {
    case 'timescale':
      return new TimescaleEngine({ ...target.config, schema: TIMESCALE_CONFORMANCE_SCHEMA });
    case 'clickhouse':
      return new ClickHouseEngine({ ...target.config });
    case 'mongodb':
      return new MongoDBEngine({ ...target.config });
  }
}

export interface CreateConformanceReservoirOptions {
  /** Probe timeout, default 3000 ms. */
  probeTimeoutMs?: number;
  /** Namespace reset timeout, default 30000 ms. */
  resetTimeoutMs?: number;
}

/**
 * Probes the target, resets its namespace, builds the engine directly (no
 * factory, so an empty MongoDB username works) and initializes it through
 * `Reservoir.fromEngine`. Errors after a successful probe propagate unchanged.
 */
export async function createConformanceReservoir(
  engine: EngineType,
  env: NodeJS.ProcessEnv = process.env,
  options: CreateConformanceReservoirOptions = {},
): Promise<Reservoir> {
  const target = resolveConformanceTarget(engine, env);
  await probeConformanceTarget(target, options.probeTimeoutMs ?? 3000);
  await resetNamespace(target, options.resetTimeoutMs ?? 30_000);
  const reservoir = Reservoir.fromEngine(constructEngine(target));
  await reservoir.initialize();
  return reservoir;
}

/**
 * Runs `create`. An unreachable server gives null plus a warning, or a loud
 * failure when conformance is required; any other error is rethrown.
 */
export async function resolveSubject<T>(engine: string, create: () => Promise<T>, required: boolean): Promise<T | null> {
  try {
    return await create();
  } catch (err) {
    if (!(err instanceof ConformanceUnavailableError)) throw err;
    if (required) {
      throw new Error(`Reservoir conformance required but ${engine} is unreachable: ${err.message}`, { cause: err });
    }
    console.warn(`Reservoir conformance skipped for ${engine}: ${err.message}. Set RESERVOIR_CONFORMANCE_REQUIRED=1 to make this a failure.`);
    return null;
  }
}
