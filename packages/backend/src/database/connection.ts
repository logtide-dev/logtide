import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Database } from './types.js';
import { currentOrNull } from '@logtide/shared/context';
import { formatContextComment } from '../context/kysely-plugin.js';
import { TenantScopeGuardPlugin } from './tenant-scope-guard.js';
import { loadTestEnv } from '../config/load-test-env.js';

const { Pool } = pg;

// Load .env.test if NODE_ENV=test (overrides existing env vars except the storage engine ones)
if (process.env.NODE_ENV === 'test') {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  loadTestEnv(path.resolve(__dirname, '../../.env.test'));
}

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/logtide';

// pg fails on an unparsable URL with "Cannot read properties of undefined (reading 'searchParams')"
// on the first query. Fail early with a useful message instead (usually a password with URL-reserved
// characters such as # % @ / ? that was not percent-encoded). Socket URLs without a host
// (user:pw@/db?host=/run/...) get the same dummy-host fallback pg-connection-string uses.
let parsedDatabaseUrl: URL;
try {
  parsedDatabaseUrl = URL.canParse(DATABASE_URL)
    ? new URL(DATABASE_URL)
    : new URL(DATABASE_URL.replace('@/', '@___DUMMY___/'));
} catch {
  throw new Error(
    'DATABASE_URL is not a valid URL. If the database password contains characters such as # % @ / ? : ' +
      'percent-encode it in DATABASE_URL (e.g. # -> %23, % -> %25) or use a password without them.'
  );
}
if (parsedDatabaseUrl.password) parsedDatabaseUrl.password = '****';
console.log('[Database Connection] Using DATABASE_URL:', parsedDatabaseUrl.toString().replace('@___DUMMY___/', '@/'));

// Connection Pool Configuration

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Tenant scope guard: opt-in tripwire that throws on unscoped tenant-table queries.
// Off by default (keeps the normal suite clean); enable with TENANT_GUARD=1 for the
// isolation suite or a one-shot audit run. Never enabled in production.
const tenantGuardEnabled = process.env.TENANT_GUARD === '1' && !isProduction;

// Pool size configuration based on environment
// Production: larger pool for high concurrency
// Development/Test: smaller pool to conserve resources
const poolConfig = {
  connectionString: DATABASE_URL,

  // Maximum number of clients in the pool
  // Production: 20 connections (can handle ~200 concurrent queries with queueing)
  // Development: 10 connections
  // Test: 5 connections
  max: isProduction ? 20 : isTest ? 5 : 10,

  // Minimum number of clients to keep idle in the pool
  // Keeps connections warm for faster response times
  min: isProduction ? 5 : isTest ? 1 : 2,

  // How long a client can be idle before being closed (ms)
  // 30 seconds is a good balance between resource usage and connection reuse
  idleTimeoutMillis: 30000,

  // Maximum time to wait for a connection from the pool (ms)
  // 5 seconds for production to fail fast, 10 seconds for dev/test
  connectionTimeoutMillis: isProduction ? 5000 : 10000,

  // Statement timeout - kill queries that run too long (ms)
  // Prevents runaway queries from blocking the database
  // Production: 30 seconds (most queries should complete in <100ms)
  // Development: 60 seconds (allow longer queries for debugging)
  statement_timeout: isProduction ? 30000 : 60000,

  // Application name for PostgreSQL logging
  // Helps identify connections in pg_stat_activity
  application_name: `logtide-${process.env.NODE_ENV || 'development'}`,
};

export const pool = new Pool(poolConfig);

// Context SQL comment injection: prepend /* req=... */ to every query string,
// transparently, so slow-query logs and pg_stat_activity carry the request id.
// Disabled when LOGTIDE_CONTEXT_SQL_COMMENT=false.
const originalQuery = pool.query.bind(pool);
(pool as unknown as { query: typeof pool.query }).query = function patchedQuery(
  this: typeof pool,
  ...args: any[]
): any {
  if (process.env.LOGTIDE_CONTEXT_SQL_COMMENT === 'false') {
    return (originalQuery as any)(...args);
  }
  const ctx = currentOrNull();
  if (!ctx) return (originalQuery as any)(...args);

  const comment = formatContextComment(ctx);
  const first = args[0];
  if (typeof first === 'string') {
    args[0] = comment + first;
  } else if (first && typeof first === 'object' && typeof first.text === 'string') {
    args[0] = { ...first, text: comment + first.text };
  }
  return (originalQuery as any)(...args);
} as typeof pool.query;

// Kysely uses pool.connect() to acquire a client and calls client.query() on it.
// Wrap connect() to install the same comment-injection on each connected client.
const originalConnect = pool.connect.bind(pool);
(pool as unknown as { connect: typeof pool.connect }).connect = (async function patchedConnect(
  this: typeof pool,
  ...args: any[]
): Promise<any> {
  const client = await (originalConnect as any)(...args);
  // pool.connect(callback) returns void; bail if no client materialized.
  if (!client || typeof client !== 'object') return client;
  // Patch the client's query method (only once per client)
  if (!(client as any).__logtideContextPatched) {
    const clientOriginalQuery = client.query.bind(client);
    (client as any).query = function patchedClientQuery(this: any, ...qArgs: any[]): any {
      if (process.env.LOGTIDE_CONTEXT_SQL_COMMENT === 'false') {
        return clientOriginalQuery(...qArgs);
      }
      const ctx = currentOrNull();
      if (!ctx) return clientOriginalQuery(...qArgs);

      const comment = formatContextComment(ctx);
      const first = qArgs[0];
      if (typeof first === 'string') {
        qArgs[0] = comment + first;
      } else if (first && typeof first === 'object' && typeof first.text === 'string') {
        qArgs[0] = { ...first, text: comment + first.text };
      }
      return clientOriginalQuery(...qArgs);
    };
    (client as any).__logtideContextPatched = true;
  }
  return client;
}) as any;

// Pool event handlers for monitoring
pool.on('connect', () => {
  // Set statement timeout on each new connection
  // This is a safety net for long-running queries
});

pool.on('error', (err) => {
  console.error('[Database Pool] Unexpected error on idle client:', err.message);
});

// Pool status logging (development only)
if (!isProduction && !isTest) {
  const poolStatusInterval = setInterval(() => {
    const { totalCount, idleCount, waitingCount } = pool;
    console.log(`[Database Pool] Total: ${totalCount}, Idle: ${idleCount}, Waiting: ${waitingCount}`);
  }, 60000); // Log every minute
  // Don't let this dev-only timer keep the process alive (clean shutdown / reloads).
  poolStatusInterval.unref();
}

const dialect = new PostgresDialect({ pool });

// Query logging configuration
const enableQueryLogging = process.env.LOG_QUERIES === 'true' || (!isProduction && !isTest);

export const db = new Kysely<Database>({
  dialect,
  plugins: tenantGuardEnabled ? [new TenantScopeGuardPlugin()] : [],
  log(event) {
    if (enableQueryLogging && event.level === 'query') {
      console.log('Query:', event.query.sql);
      console.log('Duration:', event.queryDurationMillis, 'ms');
    }
    // Always log slow queries (>100ms) even in production
    if (event.level === 'query' && event.queryDurationMillis > 100) {
      console.warn(`[Slow Query] Duration: ${event.queryDurationMillis}ms, SQL: ${event.query.sql}`);
    }
  },
});

/**
 * Get pool statistics for monitoring
 */
export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

/**
 * Close the database connection pool gracefully
 */
export async function closeDatabase() {
  console.log('[Database] Closing connection pool...');
  await db.destroy();
  console.log('[Database] Connection pool closed');
}
