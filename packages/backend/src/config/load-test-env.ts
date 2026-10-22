import dotenv from 'dotenv';

// Variables that pick the storage engine under test. A value already present
// in the process environment wins over .env.test, so a run such as
// `STORAGE_ENGINE=clickhouse CLICKHOUSE_HOST=... npx vitest run` really tests
// the chosen engine instead of silently falling back to the file's Timescale.
const ENGINE_VARS = /^(STORAGE_ENGINE|CLICKHOUSE_.*|MONGODB_.*)$/;

/**
 * Loads .env.test over the current environment (the file wins), except for
 * the storage engine variables the caller set explicitly.
 */
export function loadTestEnv(envTestPath: string): void {
  const explicit: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ENGINE_VARS.test(key)) explicit[key] = value;
  }
  dotenv.config({ path: envTestPath, override: true });
  Object.assign(process.env, explicit);
}
