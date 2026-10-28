import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseWebhookEvent } from '@logtide/shared';
import { db } from '../../../database/index.js';
import { createTestContext, createTestUser } from '../../helpers/factories.js';

const { smtpConfigured } = vi.hoisted(() => ({ smtpConfigured: { value: true } }));
vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  return { ...actual, isSmtpConfigured: vi.fn(() => smtpConfigured.value) };
});

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }));
vi.mock('../../../modules/webhooks/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/webhooks/index.js')>();
  return { ...actual, webhookDispatcher: { enqueue: enqueueMock } };
});

import { notifyProjectHealth, type NotifiableIssue } from '../../../modules/project-health/notifier.js';
import { updateProjectHealthSettings } from '../../../modules/project-health/settings.js';
import { notificationChannelsService } from '../../../modules/notification-channels/service.js';

describe('notifyProjectHealth', () => {
  let orgId: string;
  let projectId: string;
  let ownerEmail: string;
  let project: { id: string; name: string; organizationId: string };
  let issue: NotifiableIssue;

  beforeEach(async () => {
    sendMailMock.mockReset().mockResolvedValue({});
    enqueueMock.mockReset().mockResolvedValue({ deliveryId: 'del-1' });
    smtpConfigured.value = true;
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
    ownerEmail = ctx.user.email;
    project = { id: projectId, name: ctx.project.name, organizationId: orgId };
    issue = {
      id: '11111111-1111-4111-8111-111111111111',
      checkKey: 'timestamp_skew_logs',
      severity: 'warning',
      openedAt: new Date('2026-10-28T10:00:00.000Z'),
      resolvedAt: null,
      details: { count24h: 900, maxPastHours: 3 },
    };
  });

  const emailChannel = (name: string, to: string) =>
    notificationChannelsService.createChannel(orgId, {
      name,
      type: 'email',
      config: { recipients: [to] },
    });
  const webhookChannel = (name: string, url: string) =>
    notificationChannelsService.createChannel(orgId, { name, type: 'webhook', config: { url } });

  const sentTo = () => sendMailMock.mock.calls.map((c) => c[0].to);

  it('explicit per-project channels win over org defaults', async () => {
    const explicit = await emailChannel('Project', 'project@example.com');
    const fallback = await emailChannel('Default', 'default@example.com');
    await notificationChannelsService.setOrganizationDefaults(orgId, 'project_health', [fallback.id]);
    await updateProjectHealthSettings(orgId, projectId, { healthChannelIds: [explicit.id] });

    await notifyProjectHealth(issue, project, 'opened');
    expect(sentTo()).toEqual(['project@example.com']);
    expect(sendMailMock.mock.calls[0][0].subject).toContain('[WARNING]');
  });

  it('empty or disabled override falls back to org defaults for project_health', async () => {
    const disabled = await emailChannel('Disabled', 'disabled@example.com');
    await notificationChannelsService.updateChannel(disabled.id, orgId, { enabled: false });
    const fallback = await emailChannel('Default', 'default@example.com');
    await notificationChannelsService.setOrganizationDefaults(orgId, 'project_health', [fallback.id]);

    await notifyProjectHealth(issue, project, 'opened', { healthChannelIds: [] });
    expect(sentTo()).toEqual(['default@example.com']);

    sendMailMock.mockClear();
    await notifyProjectHealth(issue, project, 'opened', { healthChannelIds: [disabled.id] });
    expect(sentTo()).toEqual(['default@example.com']);
  });

  it('ignores override channels of another organization', async () => {
    const otherCtx = await createTestContext();
    const foreign = await notificationChannelsService.createChannel(otherCtx.organization.id, {
      name: 'Foreign',
      type: 'email',
      config: { recipients: ['foreign@example.com'] },
    });
    await notifyProjectHealth(issue, project, 'opened', { healthChannelIds: [foreign.id] });
    expect(sentTo()).not.toContain('foreign@example.com');
  });

  it('nothing configured: owners and admins get an email', async () => {
    const admin = await createTestUser({ email: `admin-${Date.now()}@example.com` });
    await db
      .insertInto('organization_members')
      .values({ organization_id: orgId, user_id: admin.id, role: 'admin' })
      .execute();
    const member = await createTestUser({ email: `member-${Date.now()}@example.com` });
    await db
      .insertInto('organization_members')
      .values({ organization_id: orgId, user_id: member.id, role: 'member' })
      .execute();

    await notifyProjectHealth(issue, project, 'opened');
    expect(sentTo().sort()).toEqual([admin.email, ownerEmail].sort());
  });

  it('webhook payload is an enveloped project.health.* event that validates', async () => {
    const hook = await webhookChannel('Hook', 'https://hooks.example.com/health');
    await notificationChannelsService.setOrganizationDefaults(orgId, 'project_health', [hook.id]);

    await notifyProjectHealth(issue, project, 'opened');
    await notifyProjectHealth({ ...issue, resolvedAt: new Date('2026-10-28T11:00:00.000Z') }, project, 'resolved');

    expect(enqueueMock).toHaveBeenCalledTimes(2);
    const [openCall, resolveCall] = enqueueMock.mock.calls.map((c) => c[0]);
    expect(openCall.eventType).toBe('project.health.opened');
    expect(resolveCall.eventType).toBe('project.health.resolved');
    expect(openCall.eventId).not.toBe(resolveCall.eventId);

    const opened = parseWebhookEvent(openCall.payload);
    expect(opened.projectId).toBe(projectId);
    expect(opened.data).toMatchObject({
      project_id: projectId,
      check_key: 'timestamp_skew_logs',
      severity: 'warning',
      title: 'Logs with out-of-range timestamp',
      resolved_at: null,
      details: { count24h: 900, maxPastHours: 3 },
    });
    expect(opened.data.message).toContain('900 logs');
    expect(opened.data.message).toContain('3 hours in the past');
    expect(String(opened.data.link)).toMatch(new RegExp(`/dashboard/projects/${projectId}$`));

    const resolved = parseWebhookEvent(resolveCall.payload);
    expect(resolved.data.resolved_at).toBe('2026-10-28T11:00:00.000Z');
  });

  it('PagerDuty triggers on open and resolves on resolve with one dedup key', async () => {
    const pd = await notificationChannelsService.createChannel(orgId, {
      name: 'PD',
      type: 'pagerduty',
      config: { routingKey: 'abcdefghijklmnopqrstuvwxyz012345' },
    });
    await updateProjectHealthSettings(orgId, projectId, { healthChannelIds: [pd.id] });

    await notifyProjectHealth(issue, project, 'opened');
    await notifyProjectHealth({ ...issue, resolvedAt: new Date() }, project, 'resolved');
    const payloads = enqueueMock.mock.calls.map((c) => c[0].payload as Record<string, unknown>);
    expect(payloads.map((p) => p.event_action)).toEqual(['trigger', 'resolve']);
    expect(payloads.map((p) => p.dedup_key)).toEqual([
      `project-health:${issue.id}`,
      `project-health:${issue.id}`,
    ]);
  });

  it('in-app notification for owners and admins on opened only', async () => {
    smtpConfigured.value = false;
    await notifyProjectHealth(issue, project, 'opened');
    await notifyProjectHealth({ ...issue, resolvedAt: new Date() }, project, 'resolved');

    const rows = await db
      .selectFrom('notifications')
      .selectAll()
      .where('organization_id', '=', orgId)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('project_health');
    expect(rows[0].project_id).toBe(projectId);
    expect(rows[0].metadata).toMatchObject({ issueId: issue.id, link: `/dashboard/projects/${projectId}` });
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
