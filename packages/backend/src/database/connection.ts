import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Database } from './types.js';

const { Pool } = pg;

// Load .env.test if NODE_ENV=test (override any existing env vars)
if (process.env.NODE_ENV === 'test') {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  dotenv.config({ path: path.resolve(__dirname, '../../.env.test'), override: true });
}

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/logward';
console.log('[Database Connection] Using DATABASE_URL:', DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

// Connection Pool Configuration

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

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
  application_name: `logward-${process.env.NODE_ENV || 'development'}`,
};

const pool = new Pool(poolConfig);

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
  setInterval(() => {
    const { totalCount, idleCount, waitingCount } = pool;
    console.log(`[Database Pool] Total: ${totalCount}, Idle: ${idleCount}, Waiting: ${waitingCount}`);
  }, 60000); // Log every minute
}

const dialect = new PostgresDialect({ pool });

// Query logging configuration
const enableQueryLogging = process.env.LOG_QUERIES === 'true' || (!isProduction && !isTest);

export const db = new Kysely<Database>({
  dialect,
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
