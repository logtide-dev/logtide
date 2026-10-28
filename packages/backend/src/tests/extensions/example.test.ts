import { describe, it, expect, afterAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from 'kysely';
import { db } from '../../database/index.js';
import { loadExtensionModules } from '../../extensions/loader.js';
import { initExtensions } from '../../extensions/runtime.js';

const examplePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../docs/examples/extension-example.mjs'
);

describe('docs/examples/extension-example.mjs', () => {
  afterAll(async () => {
    await sql`DROP SCHEMA IF EXISTS example CASCADE`.execute(db);
  });

  it('loads and registers a route, a migration, a job and a cron', async () => {
    const mods = await loadExtensionModules(examplePath);
    expect(mods.map((m) => m.name)).toEqual(['example']);

    const runtime = await initExtensions(mods, 'server');

    expect(runtime.extensions).toEqual(['example']);
    expect(runtime.routes.map((r) => r.name)).toEqual(['example']);
    expect(runtime.jobs.map((j) => j.queue)).toEqual(['ext:example:tick']);
    expect(runtime.crons.map((c) => c.task)).toEqual(['ext:example:tick']);

    const { rows } = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'example'
    `.execute(db);
    expect(rows.map((r) => r.table_name)).toContain('notes');
  });
});
