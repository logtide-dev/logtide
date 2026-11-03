/**
 * api.admin.audit: extension admin actions land in the core audit log.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import type { FastifyRequest } from 'fastify';
import { db } from '../../database/index.js';
import { initExtensions } from '../../extensions/runtime.js';
import type { ExtensionApi } from '../../extensions/types.js';
import { createTestUser, createTestOrganization } from '../helpers/factories.js';

const uniqueEmail = (tag: string) => `ext-audit-${tag}-${crypto.randomUUID()}@example.com`;

async function rowsFor(marker: string) {
  return db
    .selectFrom('audit_log')
    .selectAll()
    .where('action', '=', 'ext.admin_action')
    .where(({ eb, ref }) => eb(eb.fn('jsonb_extract_path_text', [ref('metadata'), eb.val('marker')]), '=', marker))
    .execute();
}

describe('api.admin.audit', () => {
  let api: ExtensionApi;
  let orgId: string;
  let user: { id: string; email: string };

  beforeEach(async () => {
    let captured: ExtensionApi | undefined;
    await initExtensions(
      [{ name: 'fixture', apiVersion: 1, register: (a) => void (captured = a) }],
      'server'
    );
    api = captured!;
    const u = await createTestUser({ email: uniqueEmail('admin') });
    user = { id: u.id, email: u.email };
    const org = await createTestOrganization({ ownerId: u.id, slug: `ext-audit-${crypto.randomUUID()}` });
    orgId = org.id;
  });

  const fakeRequest = () =>
    ({ user, ip: '203.0.113.7', headers: { 'user-agent': 'vitest' } }) as unknown as FastifyRequest;

  it('records ext.admin_action with the request user as actor', async () => {
    const marker = crypto.randomUUID();
    await api.admin.audit(
      {
        action: 'grant_created',
        organizationId: orgId,
        target: { type: 'organization', id: orgId },
        metadata: { plan: 'x', marker },
      },
      fakeRequest()
    );
    const rows = await rowsFor(marker);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actor_type).toBe('user');
    expect(row.actor_id).toBe(user.id);
    expect(row.user_email).toBe(user.email);
    expect(row.organization_id).toBe(orgId);
    expect(row.ip_address).toBe('203.0.113.7');
    expect(row.user_agent).toBe('vitest');
    expect(row.category).toBe('config_change');
    expect(row.outcome).toBe('success');
    expect(row.resource_type).toBe('organization');
    expect(row.resource_id).toBe(orgId);
    expect(row.metadata).toEqual({ extension: 'fixture', action: 'grant_created', plan: 'x', marker });
  });

  it('without a request the actor is system with label ext:<name>', async () => {
    const marker = crypto.randomUUID();
    await api.admin.audit({ action: 'sweep.expired', metadata: { marker } });
    const [row] = await rowsFor(marker);
    expect(row.actor_type).toBe('system');
    expect(row.actor_id).toBeNull();
    expect(row.user_email).toBe('ext:fixture');
    expect(row.organization_id).toBeNull();
  });

  it('rejects an invalid action name and writes nothing', async () => {
    const marker = crypto.randomUUID();
    await expect(api.admin.audit({ action: 'Bad Action', metadata: { marker } })).rejects.toThrow(/\[Extensions\]/);
    await expect(api.admin.audit({ action: 'a', metadata: { marker } })).rejects.toThrow(/\[Extensions\]/);
    expect(await rowsFor(marker)).toHaveLength(0);
  });

  it('malformed organizationId is stored as null', async () => {
    const marker = crypto.randomUUID();
    await api.admin.audit({ action: 'grant_created', organizationId: 'nope', metadata: { marker } }, fakeRequest());
    const [row] = await rowsFor(marker);
    expect(row.organization_id).toBeNull();
  });

  it('metadata cannot override extension or action', async () => {
    const marker = crypto.randomUUID();
    await api.admin.audit(
      { action: 'grant_created', metadata: { extension: 'other', action: 'x', marker } },
      fakeRequest()
    );
    const [row] = await rowsFor(marker);
    expect(row.metadata).toMatchObject({ extension: 'fixture', action: 'grant_created' });
  });

  it('records a failure outcome', async () => {
    const marker = crypto.randomUUID();
    await api.admin.audit({ action: 'grant_created', outcome: 'failure', metadata: { marker } }, fakeRequest());
    const [row] = await rowsFor(marker);
    expect(row.outcome).toBe('failure');
  });
});
