import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../../server.js';
import { truncateAllTables } from '../../helpers/index.js';
import { createTestUser, createTestOrganization, createTestProject } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';
import { providerRegistry } from '../../../modules/auth/providers/registry.js';
import { db } from '../../../database/index.js';

describe('auth audit records', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
    // audit_log is not in truncateAllTables; clear it separately
    await db.deleteFrom('audit_log').execute();
  });

  it('successful local login produces auth.login_succeeded row', async () => {
    const user = await createTestUser({ email: 'login-audit@example.com', password: 'password123' });

    const res = await request(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'login-audit@example.com', password: 'password123' })
      .expect(200);

    expect(res.body.session.token).toBeDefined();

    // Give the non-buffered record() call time to land (it is awaited inline, so
    // by the time the HTTP response is sent the INSERT is complete)
    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'auth.login_succeeded')
      .execute();

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actor_type).toBe('user');
    expect(row.actor_id).toBe(user.id);
    expect(row.outcome).toBe('success');
    expect((row.metadata as any)?.method).toBe('local');
  });

  it('failed local login (wrong password) produces auth.login_failed row', async () => {
    await createTestUser({ email: 'fail-audit@example.com', password: 'correctpass' });

    await request(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'fail-audit@example.com', password: 'wrongpass' })
      .expect(401);

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'auth.login_failed')
      .execute();

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.outcome).toBe('failure');
    expect(row.actor_id).toBeNull();
    expect(row.user_email).toBe('fail-audit@example.com');
    expect((row.metadata as any)?.method).toBe('local');
    expect((row.metadata as any)?.reason).toBe('invalid_credentials');
  });

  it('disabled-account login with correct password produces auth.login_failed row', async () => {
    await createTestUser({ email: 'disabled-audit@example.com', password: 'password123', disabled: true });

    await request(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'disabled-audit@example.com', password: 'password123' })
      .expect(401);

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'auth.login_failed')
      .execute();

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.outcome).toBe('failure');
    expect(row.actor_id).toBeNull();
    expect(row.user_email).toBe('disabled-audit@example.com');
    expect((row.metadata as any)?.method).toBe('local');
    expect((row.metadata as any)?.reason).toBe('account_disabled');
  });

  it('local login against an SSO-only account produces auth.login_failed row', async () => {
    await createTestUser({ email: 'sso-audit@example.com', password: null });

    await request(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'sso-audit@example.com', password: 'anypassword' })
      .expect(401);

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'auth.login_failed')
      .execute();

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.outcome).toBe('failure');
    expect(row.actor_id).toBeNull();
    expect(row.user_email).toBe('sso-audit@example.com');
    expect((row.metadata as any)?.method).toBe('local');
    expect((row.metadata as any)?.reason).toBe('sso_required');
  });

  it('zod-invalid login payload produces NO auth.login_failed row', async () => {
    // missing password field entirely - zod parse fails
    await request(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'someone@example.com' })
      .expect(400);

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'auth.login_failed')
      .execute();

    expect(rows).toHaveLength(0);
  });

  it('login with the local provider unavailable produces 503 and a provider_unavailable row', async () => {
    await createTestUser({ email: 'provider-down@example.com', password: 'password123' });

    // Simulate the local provider being disabled/removed
    const getProviderSpy = vi.spyOn(providerRegistry, 'getProvider').mockResolvedValueOnce(null);

    await request(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'provider-down@example.com', password: 'password123' })
      .expect(503);

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'auth.login_failed')
      .execute();

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.outcome).toBe('failure');
    expect(row.actor_id).toBeNull();
    expect(row.user_email).toBe('provider-down@example.com');
    expect((row.metadata as any)?.method).toBe('local');
    expect((row.metadata as any)?.reason).toBe('provider_unavailable');

    getProviderSpy.mockRestore();
  });
});

vi.mock('../../../config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../config/index.js')>();
  return {
    ...original,
    isSmtpConfigured: vi.fn(() => true),
  };
});

vi.mock('../../../queue/jobs/invitation-email.js', () => ({
  invitationEmailQueue: {
    add: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../../../modules/notifications/service.js', () => ({
  notificationsService: {
    createNotification: vi.fn(() => Promise.resolve({ id: 'test-notification-id' })),
  },
}));

describe('org project apikey audit records', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
    await db.deleteFrom('organization_invitations').execute();
    await db.deleteFrom('audit_log').execute();
  });

  it('org create via API produces org.created row with correct actor and resource', async () => {
    const user = await createTestUser({ email: 'org-audit@example.com', password: 'password123' });
    const session = await createTestSession(user.id);

    await request(app.server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${session.token}`)
      .send({ name: 'Audit Test Org' })
      .expect(201);

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'org.created')
      .execute();

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actor_type).toBe('user');
    expect(row.actor_id).toBe(user.id);
    expect(row.outcome).toBe('success');
    expect(row.resource_type).toBe('organization');
    expect(row.organization_id).toBeTruthy();
    expect((row.metadata as any)?.name).toBe('Audit Test Org');
  });

  it('api key create produces apikey.created with organization_id from project org', async () => {
    const user = await createTestUser({ email: 'apikey-audit@example.com', password: 'password123' });
    const org = await createTestOrganization({ ownerId: user.id });
    const project = await createTestProject({ organizationId: org.id, userId: user.id });
    const session = await createTestSession(user.id);

    await request(app.server)
      .post(`/api/v1/projects/${project.id}/api-keys`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ name: 'Test Key', type: 'write' })
      .expect(201);

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'apikey.created')
      .execute();

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.organization_id).toBe(org.id);
    expect(row.actor_type).toBe('user');
    expect(row.actor_id).toBe(user.id);
    expect(row.resource_type).toBe('api_key');
    expect(row.outcome).toBe('success');
    expect((row.metadata as any)?.projectId).toBe(project.id);
    expect((row.metadata as any)?.name).toBe('Test Key');
    expect((row.metadata as any)?.type).toBe('write');
  });

  it('invitation create produces user.invited with correct org and resource_type invitation', async () => {
    const user = await createTestUser({ email: 'invite-audit@example.com', password: 'password123' });
    const org = await createTestOrganization({ ownerId: user.id });
    const session = await createTestSession(user.id);

    await request(app.server)
      .post(`/api/v1/invitations/${org.id}/invite`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ email: 'newmember@example.com', role: 'member' })
      .expect(201);

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'user.invited')
      .execute();

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.organization_id).toBe(org.id);
    expect(row.actor_type).toBe('user');
    expect(row.actor_id).toBe(user.id);
    expect(row.resource_type).toBe('invitation');
    expect(row.outcome).toBe('success');
    expect((row.metadata as any)?.email).toBe('newmember@example.com');
    expect((row.metadata as any)?.role).toBe('member');
  });
});

const VALID_DASHBOARD_YAML = `
name: Imported Audit Dashboard
panels: []
`;

describe('coverage audit records', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
    await db.deleteFrom('notification_channels').execute();
    await db.deleteFrom('custom_dashboards').execute();
    await db.deleteFrom('log_pipelines').execute();
    await db.deleteFrom('audit_log').execute();
  });

  it('channel create produces channel.created row', async () => {
    const user = await createTestUser({ email: 'ch-audit@example.com', password: 'password123' });
    const org = await createTestOrganization({ ownerId: user.id });
    const session = await createTestSession(user.id);

    const res = await request(app.server)
      .post('/api/v1/notification-channels')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${session.token}`)
      .send({ name: 'Audit Email Channel', type: 'email', config: { recipients: ['a@example.com'] } })
      .expect(201);

    expect(res.body.channel).toBeDefined();

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'channel.created')
      .execute();

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actor_type).toBe('user');
    expect(row.actor_id).toBe(user.id);
    expect(row.outcome).toBe('success');
    expect(row.resource_type).toBe('notification_channel');
    expect(row.resource_id).toBe(res.body.channel.id);
    expect(row.organization_id).toBe(org.id);
    expect((row.metadata as any)?.name).toBe('Audit Email Channel');
    expect((row.metadata as any)?.type).toBe('email');
  });

  it('dashboard create produces dashboard.created row', async () => {
    const user = await createTestUser({ email: 'dash-audit@example.com', password: 'password123' });
    const org = await createTestOrganization({ ownerId: user.id });
    const session = await createTestSession(user.id);

    const res = await request(app.server)
      .post('/api/v1/custom-dashboards')
      .set('Authorization', `Bearer ${session.token}`)
      .send({ organizationId: org.id, name: 'Audit Dashboard' })
      .expect(201);

    expect(res.body.dashboard).toBeDefined();

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'dashboard.created')
      .execute();

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actor_type).toBe('user');
    expect(row.actor_id).toBe(user.id);
    expect(row.outcome).toBe('success');
    expect(row.resource_type).toBe('custom_dashboard');
    expect(row.resource_id).toBe(res.body.dashboard.id);
    expect(row.organization_id).toBe(org.id);
    expect((row.metadata as any)?.name).toBe('Audit Dashboard');
  });

  it('pipeline create produces pipeline.created row', async () => {
    const user = await createTestUser({ email: 'pipe-audit@example.com', password: 'password123' });
    const org = await createTestOrganization({ ownerId: user.id });
    const project = await createTestProject({ organizationId: org.id, userId: user.id });
    const session = await createTestSession(user.id);

    const res = await request(app.server)
      .post('/api/v1/log-pipelines')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        projectId: project.id,
        name: 'Audit Pipeline',
        steps: [{ type: 'parser', parser: 'nginx' }],
      })
      .expect(201);

    expect(res.body.pipeline).toBeDefined();

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'pipeline.created')
      .execute();

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actor_type).toBe('user');
    expect(row.actor_id).toBe(user.id);
    expect(row.outcome).toBe('success');
    expect(row.resource_type).toBe('log_pipeline');
    expect(row.resource_id).toBe(res.body.pipeline.id);
    expect(row.organization_id).toBe(org.id);
    expect((row.metadata as any)?.name).toBe('Audit Pipeline');
  });
});

const VALID_SIGMA_YAML = `
title: Audit Test Rule
status: stable
level: medium
logsource:
    product: linux
detection:
    selection:
        message|contains: 'suspicious'
    condition: selection
`;

describe('rule audit records', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
    await db.deleteFrom('audit_log').execute();
  });

  it('sigma rule import via API produces rule.imported row with resource_type sigma_rule, actor_type user, outcome success', async () => {
    const user = await createTestUser({ email: 'sigma-audit@example.com', password: 'password123' });
    const org = await createTestOrganization({ ownerId: user.id });
    const session = await createTestSession(user.id);

    const res = await request(app.server)
      .post('/api/v1/sigma/import')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        yaml: VALID_SIGMA_YAML,
        organizationId: org.id,
        createAlertRule: false,
      })
      .expect(200);

    expect(res.body.sigmaRule).toBeDefined();

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'rule.imported')
      .execute();

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actor_type).toBe('user');
    expect(row.actor_id).toBe(user.id);
    expect(row.outcome).toBe('success');
    expect(row.resource_type).toBe('sigma_rule');
    expect(row.organization_id).toBe(org.id);
    expect(row.resource_id).toBe(res.body.sigmaRule.id);
  });
});
