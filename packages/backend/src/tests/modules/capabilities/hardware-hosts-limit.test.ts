import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { capabilities } from '../../../capabilities/index.js';
import { CAPABILITIES } from '../../../capabilities/registry.js';
import { createTestContext, createTestProject } from '../../helpers/factories.js';
import {
  registerHardwareHosts,
  resetHardwareLimitLog,
  resetHardwareRegistrationThrottle,
} from '../../../modules/hardware/registry.js';

// hardware.max_hosts (4-case capability pattern). Registration happens on the
// ingest path, so the limit never fails ingestion: hosts beyond it are simply
// not registered.

async function setLimit(organizationId: string, limit: number) {
  await db
    .insertInto('organization_entitlements')
    .values({ organization_id: organizationId, capability: 'hardware.max_hosts', enabled: null, limit_value: limit })
    .execute();
  capabilities.invalidate(organizationId);
}

async function insertHost(organizationId: string, projectId: string, hostName: string) {
  await db
    .insertInto('hardware_hosts')
    .values({ organization_id: organizationId, project_id: projectId, host_name: hostName })
    .execute();
}

const batch = (...names: string[]) => names.map((n) => ({ metricName: 'hw.host.info', attributes: { 'host.name': n } }));

async function hostNames(organizationId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('hardware_hosts')
    .select('host_name')
    .where('organization_id', '=', organizationId)
    .orderBy('host_name')
    .execute();
  return rows.map((r) => r.host_name);
}

describe('hardware.max_hosts enforcement', () => {
  let orgId: string;
  let projectId: string;
  let userId: string;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    resetHardwareRegistrationThrottle();
    resetHardwareLimitLog();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
    userId = ctx.user.id;
    capabilities.invalidate(orgId);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('is a limit capability, unlimited by default', () => {
    expect(CAPABILITIES['hardware.max_hosts']).toMatchObject({ kind: 'limit', defaultLimit: null });
  });

  it('at limit: new hosts are not registered, known hosts keep reporting, ingestion never fails', async () => {
    await setLimit(orgId, 2);
    const other = await createTestProject({ organizationId: orgId, userId });
    // The limit is per organization: a host of another project counts.
    await insertHost(orgId, other.id, 'srv-a');
    await insertHost(orgId, projectId, 'srv-b');

    const now = new Date();
    await expect(registerHardwareHosts(batch('srv-b', 'srv-c'), projectId, orgId, now)).resolves.toEqual(['srv-b']);
    expect(await hostNames(orgId)).toEqual(['srv-a', 'srv-b']);
    const b = await db
      .selectFrom('hardware_hosts')
      .select('last_seen_at')
      .where('project_id', '=', projectId)
      .where('host_name', '=', 'srv-b')
      .executeTakeFirstOrThrow();
    expect(b.last_seen_at?.getTime()).toBe(now.getTime());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('hardware.max_hosts');

    // Logged once per project per hour.
    resetHardwareRegistrationThrottle();
    await registerHardwareHosts(batch('srv-d'), projectId, orgId, new Date(now.getTime() + 5 * 60_000));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('under limit: registers new hosts up to the limit, in batch order', async () => {
    await setLimit(orgId, 3);
    await insertHost(orgId, projectId, 'srv-a');
    expect(await registerHardwareHosts(batch('srv-x', 'srv-y', 'srv-z'), projectId, orgId)).toEqual(['srv-x', 'srv-y']);
    expect(await hostNames(orgId)).toEqual(['srv-a', 'srv-x', 'srv-y']);
  });

  it('unlimited (no entitlement): every host is registered', async () => {
    const names = Array.from({ length: 25 }, (_, i) => `h-${String(i).padStart(2, '0')}`);
    expect((await registerHardwareHosts(batch(...names), projectId, orgId)).sort()).toEqual(names);
    expect(await hostNames(orgId)).toHaveLength(25);
    expect(warn).not.toHaveBeenCalled();
  });

  it('org isolation: hosts of another organization do not count', async () => {
    await setLimit(orgId, 1);
    const other = await createTestContext();
    await insertHost(other.organization.id, other.project.id, 'srv-other-1');
    await insertHost(other.organization.id, other.project.id, 'srv-other-2');
    expect(await registerHardwareHosts(batch('srv-1'), projectId, orgId)).toEqual(['srv-1']);
    expect(await hostNames(orgId)).toEqual(['srv-1']);
  });
});
