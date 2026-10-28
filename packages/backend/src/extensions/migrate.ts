import fs from 'fs/promises';
import path from 'path';
import { sql } from 'kysely';
import { db } from '../database/index.js';

/**
 * Apply the `.sql` files of `dir` (sorted by file name) to the Postgres
 * schema `schema`, skipping the ones already recorded in
 * `<schema>.schema_migrations`. Returns the names applied by this call.
 *
 * Concurrency: everything runs in one transaction holding a transactional
 * advisory lock keyed on the schema, so the server and the worker booting
 * together serialize here and the second one sees the first one's rows.
 * Each file runs inside its own savepoint with `search_path` set to the
 * schema: a failing file is rolled back alone, the files before it stay
 * applied (committed) and the call rejects naming the file.
 *
 * The isolation level is pinned to READ COMMITTED: under an operator
 * default of REPEATABLE READ the second process would read a
 * schema_migrations snapshot that misses the first process's rows and
 * re-run the files it already applied.
 */
export async function runExtensionMigrations(schema: string, dir: string): Promise<string[]> {
  const files = (await fs.readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();
  const schemaId = sql.id(schema);
  const migrationsTable = sql.id(schema, 'schema_migrations');

  const applied: string[] = [];
  let failure: Error | undefined;

  await db.transaction().setIsolationLevel('read committed').execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`ext-migrate:${schema}`}))`.execute(trx);
    await sql`CREATE SCHEMA IF NOT EXISTS ${schemaId}`.execute(trx);
    await sql`
      CREATE TABLE IF NOT EXISTS ${migrationsTable} (
        name text PRIMARY KEY,
        applied_at timestamptz DEFAULT now()
      )
    `.execute(trx);

    const { rows } = await sql<{ name: string }>`SELECT name FROM ${migrationsTable}`.execute(trx);
    const done = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (done.has(file)) continue;
      const content = await fs.readFile(path.join(dir, file), 'utf8');

      await sql`SAVEPOINT ext_migration`.execute(trx);
      try {
        await sql`SET LOCAL search_path TO ${schemaId}`.execute(trx);
        // No parameters: pg uses the simple protocol, so multi-statement files work.
        await sql.raw(content).execute(trx);
        await sql`INSERT INTO ${migrationsTable} (name) VALUES (${file})`.execute(trx);
        await sql`RELEASE SAVEPOINT ext_migration`.execute(trx);
      } catch (err) {
        // Also restores search_path (SET LOCAL inside the savepoint is undone).
        await sql`ROLLBACK TO SAVEPOINT ext_migration`.execute(trx);
        failure = new Error(
          `[Extensions] Migration '${file}' of schema '${schema}' failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err }
        );
        break;
      }
      applied.push(file);
    }
    // Returning normally commits the files applied before a failure.
  });

  if (failure) throw failure;
  return applied;
}
