import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseWebhookEvent, type HardwareFinding } from '@logtide/shared';
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

import { notifyHardware, type NotifiableHardwareHost } from '../../../modules/hardware/notifier.js';
import { notificationChannelsService } from '../../../modules/notification-channels/service.js';

const findings: HardwareFinding[] = [
  { component: 'disks', hwId: 'S1', severity: 'critical', code: 'disk.smart_failed', message: 'Disk sda failed its SMART self assessment', value: 0, threshold: 1 },
  { component: 'memory', hwId: 'mc0', severity: 'warning', code: 'memory.corrected', message: 'Memory controller mc0 logged 3 corrected errors in the last 24 hours', value: 3, threshold: 0 },
];

describe('notifyHardware', () => {
  let orgId: string;
  let host: NotifiableHardwareHost;
  let ownerEmail: string;
  let ownerId: string;

  beforeEach(async () => {
    sendMailMock.mockReset().mockResolvedValue({});
    enqueueMock.mockReset().mockResolvedValue({ deliveryId: 'del-1' });
    smtpConfigured.value = true;
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    ownerEmail = ctx.user.email;
    ownerId = ctx.user.id;
    const row = await db
      .insertInto('hardware_hosts')
      .values({ organization_id: orgId, project_id: ctx.project.id, host_name: 'srv-1' })
      .returning('id')
      .executeTakeFirstOrThrow();
    host = { id: row.id, hostName: 'srv-1', projectId: ctx.project.id, projectName: ctx.project.name, organizationId: orgId };
  });

  const degraded = (incidentId: string | null = null) => ({
    kind: 'degraded' as const,
    status: 'critical' as const,
    previousStatus: 'ok',
    findings,
    incidentId,
    changedAt: new Date('2026-11-10T10:00:00.000Z'),
  });

  it('routes to the org default channels of the hardware event type', async () => {
    const ch = await notificationChannelsService.createChannel(orgId, { name: 'Ops', type: 'email', config: { recipients: ['ops@example.com'] } });
    await notificationChannelsService.setOrganizationDefaults(orgId, 'hardware', [ch.id]);
    await notifyHardware(host, degraded());
    expect(sendMailMock.mock.calls.map((c) => c[0].to)).toEqual(['ops@example.com']);
    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.subject).toBe('[CRITICAL] Hardware critical: srv-1');
    expect(mail.text).toContain('Disk sda failed its SMART self assessment');
  });

  it('falls back to owners and admins by email when nothing is configured', async () => {
    const admin = await createTestUser({ email: `hw-admin-${Date.now()}@example.com` });
    await db.insertInto('organization_members').values({ organization_id: orgId, user_id: admin.id, role: 'admin' }).execute();
    const member = await createTestUser({ email: `hw-member-${Date.now()}@example.com` });
    await db.insertInto('organization_members').values({ organization_id: orgId, user_id: member.id, role: 'member' }).execute();
    await notifyHardware(host, degraded());
    expect(sendMailMock.mock.calls.map((c) => c[0].to).sort()).toEqual([admin.email, ownerEmail].sort());
  });

  it('webhook payloads are valid hardware.health.* envelopes', async () => {
    const hook = await notificationChannelsService.createChannel(orgId, { name: 'Hook', type: 'webhook', config: { url: 'https://hooks.example.com/hw' } });
    await notificationChannelsService.setOrganizationDefaults(orgId, 'hardware', [hook.id]);
    await notifyHardware(host, degraded());
    await notifyHardware(host, { ...degraded(), kind: 'recovered', status: 'ok', previousStatus: 'critical', findings: [] });

    const [down, up] = enqueueMock.mock.calls.map((c) => c[0]);
    expect(down.eventType).toBe('hardware.health.degraded');
    expect(up.eventType).toBe('hardware.health.recovered');
    expect(down.eventId).not.toBe(up.eventId);
    const env = parseWebhookEvent(down.payload);
    expect(env.projectId).toBe(host.projectId);
    expect(env.data).toMatchObject({
      host_id: host.id,
      host_name: 'srv-1',
      status: 'critical',
      previous_status: 'ok',
      title: 'Hardware critical: srv-1',
    });
    expect((env.data.findings as unknown[])[0]).toMatchObject({ hw_id: 'S1', code: 'disk.smart_failed' });
    expect(String(env.data.link)).toContain(`/dashboard/hardware/${host.id}`);
    expect(parseWebhookEvent(up.payload).data).toMatchObject({ status: 'ok', findings: [] });
  });

  it('creates an in-app notification for owners on degradation only', async () => {
    await notifyHardware(host, degraded());
    await notifyHardware(host, { ...degraded(), kind: 'recovered', status: 'ok', findings: [] });
    const rows = await db
      .selectFrom('notifications')
      .selectAll()
      .where('organization_id', '=', orgId)
      .where('user_id', '=', ownerId)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'hardware', title: 'Hardware critical: srv-1' });
    expect((rows[0].metadata as Record<string, unknown>).link).toBe(`/dashboard/hardware/${host.id}`);
  });

  it('skips email when SMTP is not configured', async () => {
    smtpConfigured.value = false;
    await notifyHardware(host, degraded());
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
