import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

import type { EngineType, TraceRecord, LogRecord } from '@logtide/reservoir';
import { Reservoir } from '@logtide/reservoir';
import pg from 'pg';
import { applyConnectionUrls } from '../config/connection-urls.js';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CliArgs {
  from?: EngineType;
  to?: EngineType;
  dryRun: boolean;
  projectId?: string;
  batchSize: number;
  skipValidation: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const opts: CliArgs = { dryRun: false, batchSize: 5000, skipValidation: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--from':
        opts.from = args[++i] as EngineType;
        break;
      case '--to':
        opts.to = args[++i] as EngineType;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--project-id':
        opts.projectId = args[++i];
        break;
      case '--batch-size':
        opts.batchSize = parseInt(args[++i], 10);
        break;
      case '--skip-validation':
        opts.skipValidation = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        printHelp();
        process.exit(1);
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
Storage Migration Script - Migrate data between TimescaleDB and ClickHouse

Usage:
  npx tsx src/scripts/migrate-storage.ts [options]

Options:
  --from <engine>       Source engine (timescale|clickhouse). Default: current STORAGE_ENGINE
  --to <engine>         Destination engine. Default: the other engine
  --dry-run             Show counts only, don't migrate
  --project-id <uuid>   Migrate a single project only
  --batch-size <n>      Records per batch (default: 5000)
  --skip-validation     Skip post-migration count validation
  --help                Show this help

Examples:
  npx tsx src/scripts/migrate-storage.ts
  npx tsx src/scripts/migrate-storage.ts --from timescale --to clickhouse
  npx tsx src/scripts/migrate-storage.ts --dry-run
  npx tsx src/scripts/migrate-storage.ts --project-id 550e8400-e29b-41d4-a716-446655440000 --batch-size 2000
`);
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getTimescaleConfig() {
  applyConnectionUrls();
  const url = process.env.DATABASE_URL || 'postgresql://localhost:5432/logtide';
  return { connectionString: url };
}

function getClickHouseConfig() {
  return {
    host: process.env.CLICKHOUSE_HOST || 'localhost',
    port: parseInt(process.env.CLICKHOUSE_PORT || '8123', 10),
    database: process.env.CLICKHOUSE_DATABASE || 'logtide',
    username: process.env.CLICKHOUSE_USERNAME || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
  };
}

function createReservoir(engine: EngineType, pgPool?: pg.Pool): Reservoir {
  if (engine === 'timescale') {
    if (!pgPool) throw new Error('pgPool required for timescale engine');
    return new Reservoir('timescale', { host: '', port: 0, database: '', username: '', password: '' }, {
      pool: pgPool,
      tableName: 'logs',
      skipInitialize: true,
    });
  }

  const chConfig = getClickHouseConfig();
  return new Reservoir('clickhouse', chConfig, {
    tableName: 'logs',
    skipInitialize: false,
  });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

function fmtRate(count: number, ms: number): string {
  if (ms <= 0) return '0/sec';
  return `${fmt(Math.round((count / ms) * 1000))}/sec`;
}

// ---------------------------------------------------------------------------
// Progress display
// ---------------------------------------------------------------------------

function printProgress(label: string, done: number, total: number, startMs: number): void {
  const pct = total > 0 ? ((done / total) * 100).toFixed(1) : '100.0';
  const elapsed = Date.now() - startMs;
  const rate = fmtRate(done, elapsed);
  const eta = done > 0 ? fmtDuration(Math.round(((total - done) / done) * elapsed)) : '?';
  process.stdout.write(`\r  ${label} ${pct}% | ${fmt(done)}/${fmt(total)} | ${rate} | ETA: ${eta}   `);
}

// ---------------------------------------------------------------------------
// Migration logic
// ---------------------------------------------------------------------------

async function countLogs(reservoir: Reservoir, projectId: string): Promise<number> {
  const result = await reservoir.count({
    projectId,
    from: new Date('2000-01-01'),
    to: new Date('2100-01-01'),
  });
  return result.count;
}

async function countSpans(reservoir: Reservoir, projectId: string): Promise<number> {
  const result = await reservoir.querySpans({
    projectId,
    from: new Date('2000-01-01'),
    to: new Date('2100-01-01'),
    limit: 0,
  });
  return result.total;
}

async function countTraces(reservoir: Reservoir, projectId: string): Promise<number> {
  const result = await reservoir.queryTraces({
    projectId,
    from: new Date('2000-01-01'),
    to: new Date('2100-01-01'),
    limit: 0,
  });
  return result.total;
}

async function migrateLogs(
  _source: Reservoir,
  dest: Reservoir,
  projectId: string,
  batchSize: number,
  sourceCount: number,
  _destCount: number,
  pgPool?: pg.Pool,
): Promise<{ migrated: number; errors: number }> {
  if (sourceCount <= 0 || !pgPool) return { migrated: 0, errors: 0 };

  let migrated = 0;
  let errors = 0;
  const startMs = Date.now();

  // Use a PostgreSQL server-side cursor to stream rows without ORDER BY or OFFSET
  // This is the fastest way to read a large table sequentially
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DECLARE migrate_cursor CURSOR FOR
       SELECT id, time, project_id, service, level, message, metadata, trace_id, span_id
       FROM logs WHERE project_id = $1`,
      [projectId],
    );

    while (migrated < sourceCount) {
      const result = await client.query(`FETCH ${batchSize} FROM migrate_cursor`);
      if (result.rows.length === 0) break;

      const logs: LogRecord[] = result.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        time: row.time as Date,
        projectId: row.project_id as string,
        service: row.service as string,
        level: row.level as LogRecord['level'],
        message: row.message as string,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata as string) : (row.metadata ?? {}),
        traceId: (row.trace_id as string) || undefined,
        spanId: (row.span_id as string) || undefined,
      }));

      try {
        const ingestResult = await dest.ingest(logs);
        if (ingestResult.failed > 0) {
          errors += ingestResult.failed;
        }
      } catch (err) {
        errors += logs.length;
        console.error(`\n    Batch error: ${err instanceof Error ? err.message : err}`);
      }

      migrated += result.rows.length;
      printProgress('Logs:', migrated, sourceCount, startMs);
    }

    await client.query('CLOSE migrate_cursor');
    await client.query('COMMIT');
  } finally {
    client.release();
  }

  const elapsed = Date.now() - startMs;
  process.stdout.write(`\r  Logs: 100.0% | ${fmt(migrated)}/${fmt(sourceCount)} | done in ${fmtDuration(elapsed)}   \n`);

  return { migrated, errors };
}

async function migrateSpans(
  source: Reservoir,
  dest: Reservoir,
  projectId: string,
  batchSize: number,
  sourceCount: number,
  destCount: number,
): Promise<{ migrated: number; errors: number }> {
  const toMigrate = sourceCount - destCount;
  if (toMigrate <= 0) return { migrated: 0, errors: 0 };

  let migrated = 0;
  let errors = 0;
  let offset = destCount;
  const startMs = Date.now();

  while (migrated < toMigrate) {
    const result = await source.querySpans({
      projectId,
      from: new Date('2000-01-01'),
      to: new Date('2100-01-01'),
      limit: batchSize,
      offset,
      sortBy: 'start_time',
      sortOrder: 'asc',
    });

    if (result.spans.length === 0) break;

    try {
      const ingestResult = await dest.ingestSpans(result.spans);
      if (ingestResult.failed > 0) {
        errors += ingestResult.failed;
        const retryResult = await dest.ingestSpans(result.spans);
        if (retryResult.failed > 0) {
          console.error(`\n    Span batch at offset ${offset} failed after retry: ${retryResult.errors?.[0]?.error}`);
        } else {
          errors -= ingestResult.failed;
        }
      }
    } catch (err) {
      errors += result.spans.length;
      console.error(`\n    Span batch at offset ${offset} error: ${err instanceof Error ? err.message : err}`);
    }

    migrated += result.spans.length;
    offset += result.spans.length;
    printProgress('Spans:', migrated, toMigrate, startMs);
  }

  const elapsed = Date.now() - startMs;
  process.stdout.write(`\r  Spans: 100.0% | ${fmt(migrated)}/${fmt(toMigrate)} | done in ${fmtDuration(elapsed)}   \n`);

  return { migrated, errors };
}

async function migrateTraces(
  source: Reservoir,
  _dest: Reservoir,
  projectId: string,
  sourceCount: number,
  destCount: number,
): Promise<{ migrated: number; errors: number }> {
  const toMigrate = sourceCount - destCount;
  if (toMigrate <= 0) return { migrated: 0, errors: 0 };

  let migrated = 0;
  let errors = 0;
  let offset = destCount;
  const startMs = Date.now();
  const concurrency = 200;

  while (migrated < toMigrate) {
    const result = await source.queryTraces({
      projectId,
      from: new Date('2000-01-01'),
      to: new Date('2100-01-01'),
      limit: 2000,
      offset,
    });

    if (result.traces.length === 0) break;

    // Fire all upserts with high concurrency
    for (let i = 0; i < result.traces.length; i += concurrency) {
      const group = result.traces.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        group.map((trace: TraceRecord) => _dest.upsertTrace(trace)),
      );

      for (const r of results) {
        if (r.status === 'rejected') {
          errors++;
          console.error(`\n    Trace upsert error: ${r.reason}`);
        }
      }
    }

    migrated += result.traces.length;
    offset += result.traces.length;
    printProgress('Traces:', migrated, toMigrate, startMs);
  }

  const elapsed = Date.now() - startMs;
  process.stdout.write(`\r  Traces: 100.0% | ${fmt(migrated)}/${fmt(toMigrate)} | done in ${fmtDuration(elapsed)}   \n`);

  return { migrated, errors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs();

  // Determine direction
  const currentEngine = (process.env.STORAGE_ENGINE as EngineType) || 'timescale';
  const fromEngine: EngineType = opts.from ?? currentEngine;
  const toEngine: EngineType = opts.to ?? (fromEngine === 'timescale' ? 'clickhouse' : 'timescale');

  if (fromEngine === toEngine) {
    console.error('Error: source and destination engines are the same.');
    process.exit(1);
  }

  if (!['timescale', 'clickhouse'].includes(fromEngine) || !['timescale', 'clickhouse'].includes(toEngine)) {
    console.error('Error: engines must be "timescale" or "clickhouse".');
    process.exit(1);
  }

  console.log(`\nStorage Migration: ${fromEngine} → ${toEngine}`);
  console.log('='.repeat(50));

  if (opts.dryRun) {
    console.log('(DRY RUN - no data will be written)\n');
  } else {
    console.log('');
  }

  // Create pg pool (needed for timescale engine and for querying projects table)
  const tsConfig = getTimescaleConfig();
  const pgPool = new Pool({ connectionString: tsConfig.connectionString, max: 5 });

  // Create reservoirs
  const source = createReservoir(fromEngine, pgPool);
  const dest = createReservoir(toEngine, pgPool);

  await source.initialize();
  await dest.initialize();

  // Get project list
  let projectRows: Array<{ id: string; name: string; org_name: string }>;

  if (opts.projectId) {
    const result = await pgPool.query(
      `SELECT p.id, p.name, o.name AS org_name
       FROM projects p
       JOIN organizations o ON o.id = p.organization_id
       WHERE p.id = $1`,
      [opts.projectId],
    );
    projectRows = result.rows;
    if (projectRows.length === 0) {
      console.error(`Error: project ${opts.projectId} not found.`);
      process.exit(1);
    }
  } else {
    const result = await pgPool.query(
      `SELECT p.id, p.name, o.name AS org_name
       FROM projects p
       JOIN organizations o ON o.id = p.organization_id
       ORDER BY o.name, p.name`,
    );
    projectRows = result.rows;
  }

  // Count organizations
  const orgNames = new Set(projectRows.map((r) => r.org_name));
  console.log(`Found ${projectRows.length} project(s) across ${orgNames.size} organization(s)\n`);

  // Migration stats
  const summary = {
    projects: 0,
    logs: 0,
    spans: 0,
    traces: 0,
    errors: 0,
    startMs: Date.now(),
  };

  for (let i = 0; i < projectRows.length; i++) {
    const project = projectRows[i];
    console.log(`[${i + 1}/${projectRows.length}] ${project.name} (${project.org_name})`);

    // Count source and dest
    const [srcLogs, srcSpans, srcTraces, dstLogs, dstSpans, dstTraces] = await Promise.all([
      countLogs(source, project.id),
      countSpans(source, project.id),
      countTraces(source, project.id),
      countLogs(dest, project.id),
      countSpans(dest, project.id),
      countTraces(dest, project.id),
    ]);

    const logsToMigrate = Math.max(0, srcLogs - dstLogs);
    const spansToMigrate = Math.max(0, srcSpans - dstSpans);
    const tracesToMigrate = Math.max(0, srcTraces - dstTraces);

    console.log(`  Logs:   source=${fmt(srcLogs)} | dest=${fmt(dstLogs)} | to migrate=${fmt(logsToMigrate)}`);
    console.log(`  Spans:  source=${fmt(srcSpans)} | dest=${fmt(dstSpans)} | to migrate=${fmt(spansToMigrate)}`);
    console.log(`  Traces: source=${fmt(srcTraces)} | dest=${fmt(dstTraces)} | to migrate=${fmt(tracesToMigrate)}`);

    if (opts.dryRun) {
      console.log('');
      summary.projects++;
      continue;
    }

    if (logsToMigrate === 0 && spansToMigrate === 0 && tracesToMigrate === 0) {
      console.log('  Already migrated.\n');
      summary.projects++;
      continue;
    }

    console.log('');

    // Migrate logs
    if (logsToMigrate > 0) {
      const logResult = await migrateLogs(source, dest, project.id, opts.batchSize, srcLogs, dstLogs, pgPool);
      summary.logs += logResult.migrated;
      summary.errors += logResult.errors;
    }

    // Migrate spans
    if (spansToMigrate > 0) {
      const spanResult = await migrateSpans(source, dest, project.id, opts.batchSize, srcSpans, dstSpans);
      summary.spans += spanResult.migrated;
      summary.errors += spanResult.errors;
    }

    // Migrate traces
    if (tracesToMigrate > 0) {
      const traceResult = await migrateTraces(source, dest, project.id, srcTraces, dstTraces);
      summary.traces += traceResult.migrated;
      summary.errors += traceResult.errors;
    }

    // Validate
    if (!opts.skipValidation) {
      const [finalLogs, finalSpans, finalTraces] = await Promise.all([
        countLogs(dest, project.id),
        countSpans(dest, project.id),
        countTraces(dest, project.id),
      ]);

      const logsOk = finalLogs >= srcLogs ? 'OK' : `MISMATCH (${fmt(finalLogs)}/${fmt(srcLogs)})`;
      const spansOk = finalSpans >= srcSpans ? 'OK' : `MISMATCH (${fmt(finalSpans)}/${fmt(srcSpans)})`;
      const tracesOk = finalTraces >= srcTraces ? 'OK' : `MISMATCH (${fmt(finalTraces)}/${fmt(srcTraces)})`;

      console.log(`  Validation: logs ${logsOk} | spans ${spansOk} | traces ${tracesOk}`);
    }

    summary.projects++;
    console.log('');
  }

  // Print summary
  const totalMs = Date.now() - summary.startMs;
  console.log('Summary');
  console.log('='.repeat(50));
  console.log(`Projects: ${summary.projects}/${projectRows.length} completed`);
  console.log(`Logs:     ${fmt(summary.logs)} migrated`);
  console.log(`Spans:    ${fmt(summary.spans)} migrated`);
  console.log(`Traces:   ${fmt(summary.traces)} migrated`);
  console.log(`Time:     ${fmtDuration(totalMs)}`);
  console.log(`Errors:   ${summary.errors}`);

  // Cleanup
  await source.close();
  await dest.close();
  await pgPool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
