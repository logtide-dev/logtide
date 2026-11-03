/**
 * Backend and worker take PostgreSQL and Redis either as one URL (DATABASE_URL,
 * REDIS_URL) or as separate settings:
 *
 *   DB_HOST, DB_PORT (5432), DB_USER, DB_PASSWORD, DB_NAME
 *   REDIS_HOST, REDIS_PORT (6379), REDIS_PASSWORD
 *
 * With separate settings the URL is built here with every part percent-encoded,
 * so a password with # % @ / ? : works as-is. An explicit URL always wins, for
 * existing installs and managed databases. An empty URL counts as unset.
 */

type Env = Record<string, string | undefined>;

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

function formatHost(host: string): string {
  // IPv6 literals need brackets in a URL
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

export function buildDatabaseUrl(env: Env): string | undefined {
  const host = nonEmpty(env.DB_HOST);
  if (!host) return undefined;

  const user = nonEmpty(env.DB_USER);
  const name = nonEmpty(env.DB_NAME);
  const missing = [!user && 'DB_USER', !name && 'DB_NAME'].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`DB_HOST is set but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing`);
  }

  const password = env.DB_PASSWORD ? `:${encodeURIComponent(env.DB_PASSWORD)}` : '';
  const port = nonEmpty(env.DB_PORT) ?? '5432';
  return `postgresql://${encodeURIComponent(user!)}${password}@${formatHost(host)}:${port}/${encodeURIComponent(name!)}`;
}

export function buildRedisUrl(env: Env): string | undefined {
  const host = nonEmpty(env.REDIS_HOST);
  if (!host) return undefined;

  const password = env.REDIS_PASSWORD ? `:${encodeURIComponent(env.REDIS_PASSWORD)}@` : '';
  const port = nonEmpty(env.REDIS_PORT) ?? '6379';
  return `redis://${password}${formatHost(host)}:${port}`;
}

/** Fills DATABASE_URL and REDIS_URL from the separate settings when they are not set. Idempotent. */
export function applyConnectionUrls(env: Env = process.env): void {
  for (const [key, build] of [
    ['DATABASE_URL', buildDatabaseUrl],
    ['REDIS_URL', buildRedisUrl],
  ] as const) {
    if (nonEmpty(env[key])) continue;
    const built = build(env);
    if (built) env[key] = built;
    else delete env[key];
  }
}
