/**
 * Extension data surface: per-extension schema + migrations and the
 * entitlement / retention / org helpers handed to register().
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { sql } from 'kysely';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../../database/index.js';
import { config } from '../../config/index.js';
import { runExtensionMigrations } from '../../extensions/migrate.js';
import { initExtensions } from '../../extensions/runtime.js';
import type { ExtensionApi, LogtideExtension } from '../../extensions/types.js';
import { createTestUser, createTestOrganization } from '../helpers/factories.js';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/extensions/migrations'
);

const uniqueEmail = (tag: string) => `ext-data-${tag}-${crypto.randomUUID()}@example.com`;

async function appliedMigrations(): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`
    SELECT name FROM fixture.schema_migrations ORDER BY name
  `.execute(db);
  return rows.map((r) => r.name);
}

async function tableExists(table: string): Promise<boolean> {
  const { rows } = await sql<{ exists: boolean }>`
    SELECT to_regclass(${`fixture.${table}`}) IS NOT NULL AS exists
  `.execute(db);
  return rows[0].exists;
}

/** Runtime fixture that captures its api and optionally registers migrations. */
function captureFixture(withMigrations: boolean): { mod: LogtideExtension; api: () => ExtensionApi } {
  let captured: ExtensionApi | undefined;
  return {
    mod: {
      name: 'fixture',
      apiVersion: 1,
      register(api) {
        captured = api;
        if (withMigrations) api.migrate(MIGRATIONS_DIR);
      },
    },
    api: () => captured!,
  };
}

const tmpDirs: string[] = [];

afterEach(async () => {
  await sql`DROP SCHEMA IF EXISTS fixture CASCADE`.execute(db);
});

afterAll(async () => {
  for (const dir of tmpDirs) await fs.rm(dir, { recursive: true, force: true });
});

describe('runExtensionMigrations', () => {
  it('creates the schema and tables and returns the applied files in order', async () => {
    const applied = await runExtensionMigrations('fixture', MIGRATIONS_DIR);
    expect(applied).toEqual(['001_init.sql', '002_more.sql']);
    expect(await tableExists('widgets')).toBe(true);
    expect(await tableExists('gadgets')).toBe(true);
    expect(await appliedMigrations()).toEqual(['001_init.sql', '002_more.sql']);
    // Nothing leaked into the public schema through the search_path.
    const { rows } = await sql<{ t: string | null }>`SELECT to_regclass('public.widgets')::text AS t`.execute(db);
    expect(rows[0].t).toBeNull();
  });

  it('is idempotent: a second run applies nothing', async () => {
    await runExtensionMigrations('fixture', MIGRATIONS_DIR);
    expect(await runExtensionMigrations('fixture', MIGRATIONS_DIR)).toEqual([]);
    expect(await appliedMigrations()).toHaveLength(2);
  });

  it('applies each file exactly once when two runs race', async () => {
    const [a, b] = await Promise.all([
      runExtensionMigrations('fixture', MIGRATIONS_DIR),
      runExtensionMigrations('fixture', MIGRATIONS_DIR),
    ]);
    expect([...a, ...b].sort()).toEqual(['001_init.sql', '002_more.sql']);
    expect(await appliedMigrations()).toHaveLength(2);
    const { rows } = await sql<{ n: string }>`SELECT count(*) AS n FROM fixture.widgets`.execute(db);
    expect(Number(rows[0].n)).toBe(1);
  });

  it('runs the migrations at READ COMMITTED', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ext-migrate-'));
    tmpDirs.push(dir);
    await fs.writeFile(
      path.join(dir, '001_level.sql'),
      "CREATE TABLE level AS SELECT current_setting('transaction_isolation') AS value;"
    );
    await runExtensionMigrations('fixture', dir);
    const { rows } = await sql<{ value: string }>`SELECT value FROM fixture.level`.execute(db);
    expect(rows[0].value).toBe('read committed');
  });

  it('rejects on invalid SQL and keeps only the earlier files applied', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ext-migrate-'));
    tmpDirs.push(dir);
    await fs.copyFile(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(dir, '001_init.sql'));
    await fs.writeFile(path.join(dir, '002_broken.sql'), 'CREATE TABLE half (id int);\nTHIS IS NOT SQL;\n');
    await fs.writeFile(path.join(dir, '003_after.sql'), 'CREATE TABLE after_broken (id int);\n');

    await expect(runExtensionMigrations('fixture', dir)).rejects.toThrow(/002_broken\.sql/);
    expect(await appliedMigrations()).toEqual(['001_init.sql']);
    expect(await tableExists('widgets')).toBe(true);
    expect(await tableExists('half')).toBe(false);
    expect(await tableExists('after_broken')).toBe(false);
  });

  it('ignores non-sql files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ext-migrate-'));
    tmpDirs.push(dir);
    await fs.copyFile(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(dir, '001_init.sql'));
    await fs.writeFile(path.join(dir, 'README.md'), 'not a migration');
    expect(await runExtensionMigrations('fixture', dir)).toEqual(['001_init.sql']);
  });
});

describe('extension data api', () => {
  it('exposes the database url and the extension schema', async () => {
    const fx = captureFixture(false);
    await initExtensions([fx.mod], 'server');
    expect(fx.api().database).toEqual({ url: config.DATABASE_URL, schema: 'fixture' });
  });

  it('initExtensions applies the migrations registered with api.migrate', async () => {
    const fx = captureFixture(true);
    await initExtensions([fx.mod], 'server');
    expect(await appliedMigrations()).toEqual(['001_init.sql', '002_more.sql']);
    // Second boot (e.g. the worker) is a no-op.
    await initExtensions([captureFixture(true).mod], 'worker');
    expect(await appliedMigrations()).toHaveLength(2);
  });

  it('migrate() outside register() throws', async () => {
    const fx = captureFixture(false);
    await initExtensions([fx.mod], 'server');
    expect(() => fx.api().migrate(MIGRATIONS_DIR)).toThrow(/inside register/);
  });

  it('a failing migration makes initExtensions fail', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ext-migrate-'));
    tmpDirs.push(dir);
    await fs.writeFile(path.join(dir, '001_bad.sql'), 'NOT SQL;\n');
    const mod: LogtideExtension = {
      name: 'fixture',
      apiVersion: 1,
      register(api) {
        api.migrate(dir);
      },
    };
    await expect(initExtensions([mod], 'server')).rejects.toThrow(/fixture.*migrat/i);
  });

  describe('entitlements, retention and orgs', () => {
    let api: ExtensionApi;
    let orgId: string;
    let ownerId: string;
    let adminId: string;
    let otherOrgAdminId: string;

    beforeEach(async () => {
      const fx = captureFixture(false);
      await initExtensions([fx.mod], 'server');
      api = fx.api();

      const owner = await createTestUser({ email: uniqueEmail('owner') });
      const admin = await createTestUser({ email: uniqueEmail('admin') });
      const member = await createTestUser({ email: uniqueEmail('member') });
      const org = await createTestOrganization({
        ownerId: owner.id,
        name: 'Data Fixture Org',
        slug: `ext-data-${crypto.randomUUID()}`,
      });
      await db
        .insertInto('organization_members')
        .values([
          { user_id: admin.id, organization_id: org.id, role: 'admin' },
          { user_id: member.id, organization_id: org.id, role: 'member' },
        ])
        .execute();

      const otherOwner = await createTestUser({ email: uniqueEmail('other-owner') });
      const otherAdmin = await createTestUser({ email: uniqueEmail('other-admin') });
      const otherOrg = await createTestOrganization({
        ownerId: otherOwner.id,
        slug: `ext-data-${crypto.randomUUID()}`,
      });
      await db
        .insertInto('organization_members')
        .values({ user_id: otherAdmin.id, organization_id: otherOrg.id, role: 'admin' })
        .execute();

      orgId = org.id;
      ownerId = owner.id;
      adminId = admin.id;
      otherOrgAdminId = otherAdmin.id;
    });

    it('entitlements.set audits with the extension actor and get reads it back', async () => {
      await api.entitlements.set(orgId, [{ capability: 'projects.max', limitValue: 7 }]);

      const audit = await db
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'org.entitlements_updated')
        .where('organization_id', '=', orgId)
        .orderBy('time', 'desc')
        .executeTakeFirst();
      expect((audit!.metadata as Record<string, unknown>).actor).toBe('ext:fixture');

      const res = await api.entitlements.get(orgId);
      expect(res.overrides['projects.max']).toEqual({ enabled: null, limitValue: 7 });

      expect(await api.entitlements.reset(orgId, 'projects.max')).toEqual({ removed: true });
      const resetAudit = await db
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'org.entitlements_updated')
        .where('organization_id', '=', orgId)
        .orderBy('time', 'desc')
        .executeTakeFirst();
      expect((resetAudit!.metadata as Record<string, unknown>).actor).toBe('ext:fixture');
    });

    it('retention.set audits with the extension actor', async () => {
      await api.retention.set(orgId, { retentionDays: 14 });
      const audit = await db
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'org.retention_updated')
        .where('organization_id', '=', orgId)
        .orderBy('time', 'desc')
        .executeTakeFirst();
      expect((audit!.metadata as Record<string, unknown>).actor).toBe('ext:fixture');
      const policy = await api.retention.get(orgId);
      expect(policy.retentionDays).toBe(14);
    });

    it('orgs.get returns id and name, null when missing or malformed', async () => {
      expect(await api.orgs.get(orgId)).toEqual({ id: orgId, name: 'Data Fixture Org' });
      expect(await api.orgs.get(crypto.randomUUID())).toBeNull();
      expect(await api.orgs.get('not-a-uuid')).toBeNull();
    });

    it('orgs.listOwnersAndAdmins excludes members and other organizations', async () => {
      const list = await api.orgs.listOwnersAndAdmins(orgId);
      const byId = new Map(list.map((e) => [e.userId, e]));
      expect(list).toHaveLength(2);
      expect(byId.get(ownerId)?.role).toBe('owner');
      expect(byId.get(adminId)?.role).toBe('admin');
      expect(byId.get(adminId)?.email).toMatch(/^ext-data-admin-/);
      expect(byId.has(otherOrgAdminId)).toBe(false);
    });

    it('orgs.listOwnersAndAdmins returns [] for a malformed org id', async () => {
      expect(await api.orgs.listOwnersAndAdmins('not-a-uuid')).toEqual([]);
    });
  });
});
