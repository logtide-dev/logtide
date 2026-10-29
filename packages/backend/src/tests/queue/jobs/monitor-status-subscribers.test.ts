import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { config } from '../../../config/index.js';
import { createTestContext } from '../../helpers/index.js';

const { sendMail, queueAdd } = vi.hoisted(() => ({
  sendMail: vi.fn(),
  queueAdd: vi.fn(),
}));

vi.mock('../../../lib/mailer.js', () => ({
  getMailer: () => ({ sendMail }),
}));
vi.mock('../../../queue/connection.js', () => ({
  createQueue: vi.fn(() => ({ add: queueAdd, close: vi.fn() })),
  createWorker: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
  getConnection: () => null,
}));

import {
  processStatusSubscriberNotification,
  enqueueStatusSubscriberNotification,
  type StatusSubscriberJob,
} from '../../../queue/jobs/monitor-status-subscribers.js';
import { verifyUnsubscribeToken } from '../../../modules/monitoring/subscribers.js';

let ctx: Awaited<ReturnType<typeof createTestContext>>;

function job(over: Partial<StatusSubscriberJob> = {}) {
  return {
    id: 'j1',
    name: 'status-subscriber-incident_created',
    data: {
      kind: 'incident_created',
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      title: 'API errors',
      status: 'investigating',
      message: 'We are looking into it',
      ...over,
    } as StatusSubscriberJob,
  };
}

async function addSubscriber(email: string, confirmed: boolean) {
  const row = await db
    .insertInto('status_page_subscribers')
    .values({
      organization_id: ctx.organization.id,
      project_id: ctx.project.id,
      email,
      email_normalized: email.toLowerCase(),
      confirmed_at: confirmed ? new Date() : null,
      confirm_token_hash: confirmed ? null : 'b'.repeat(64),
      confirm_expires_at: confirmed ? null : new Date(Date.now() + 3600_000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

beforeEach(async () => {
  sendMail.mockReset().mockResolvedValue({});
  queueAdd.mockReset().mockResolvedValue({ id: 'x' });
  ctx = await createTestContext();
  await db.updateTable('projects').set({ status_page_visibility: 'public' }).where('id', '=', ctx.project.id).execute();
});

describe('processStatusSubscriberNotification', () => {
  it('sends one email per confirmed subscriber in batches of 50 and skips pending ones', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      organization_id: ctx.organization.id,
      project_id: ctx.project.id,
      email: `user${i}@example.com`,
      email_normalized: `user${i}@example.com`,
      confirmed_at: new Date(),
    }));
    await db.insertInto('status_page_subscribers').values(rows).execute();
    await addSubscriber('pending@example.com', false);

    let inFlight = 0;
    let maxInFlight = 0;
    sendMail.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return {};
    });

    await processStatusSubscriberNotification(job());
    expect(sendMail).toHaveBeenCalledTimes(120);
    const recipients = sendMail.mock.calls.map((c) => c[0].to);
    expect(recipients).not.toContain('pending@example.com');
    expect(new Set(recipients).size).toBe(120);
    expect(maxInFlight).toBeLessThanOrEqual(50);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('each email carries its own unsubscribe link and a List-Unsubscribe header', async () => {
    const idA = await addSubscriber('a@example.com', true);
    const idB = await addSubscriber('b@example.com', true);
    await processStatusSubscriberNotification(job());
    expect(sendMail).toHaveBeenCalledTimes(2);

    const byTo = new Map(sendMail.mock.calls.map((c) => [c[0].to as string, c[0]]));
    for (const [email, id] of [['a@example.com', idA], ['b@example.com', idB]] as const) {
      const mail = byTo.get(email)!;
      const header: string = mail.headers['List-Unsubscribe'];
      expect(header).toMatch(/^<.+>$/);
      const url = new URL(header.slice(1, -1));
      expect(url.pathname).toBe(`/status/${ctx.organization.slug}/${ctx.project.slug}/unsubscribe`);
      expect(verifyUnsubscribeToken(url.searchParams.get('token')!)).toBe(id);
      expect(mail.text).toContain(header.slice(1, -1));
      expect(mail.html).toContain('Unsubscribe');
    }
  });

  it('a failing recipient does not stop the others', async () => {
    await addSubscriber('ok1@example.com', true);
    await addSubscriber('bad@example.com', true);
    await addSubscriber('ok2@example.com', true);
    sendMail.mockImplementation(async (m: any) => {
      if (m.to === 'bad@example.com') throw new Error('mailbox full');
      return {};
    });
    await expect(processStatusSubscriberNotification(job())).resolves.toBeUndefined();
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('does nothing when the project is not public', async () => {
    await addSubscriber('a@example.com', true);
    await db.updateTable('projects').set({ status_page_visibility: 'password' }).where('id', '=', ctx.project.id).execute();
    await processStatusSubscriberNotification(job());
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does nothing when SMTP is missing', async () => {
    await addSubscriber('a@example.com', true);
    const original = config.SMTP_HOST;
    (config as any).SMTP_HOST = undefined;
    try {
      await processStatusSubscriberNotification(job());
    } finally {
      (config as any).SMTP_HOST = original;
    }
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('never mails subscribers of another organization even with a mismatched job', async () => {
    await addSubscriber('a@example.com', true);
    const other = await createTestContext();
    await processStatusSubscriberNotification(job({ organizationId: other.organization.id }));
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('email subject and body use the status page title when set', async () => {
    await addSubscriber('a@example.com', true);
    await db
      .insertInto('status_page_config')
      .values({ project_id: ctx.project.id, organization_id: ctx.organization.id, title: 'Acme <Cloud> status' })
      .execute();
    await processStatusSubscriberNotification(job());
    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toBe('[Acme <Cloud> status] Incident: API errors');
    expect(mail.html).toContain('Acme &lt;Cloud&gt; status');
    expect(mail.html).not.toContain('Acme <Cloud>');
    expect(mail.text).toContain('We are looking into it');
  });

  it('falls back to the project name without a title and labels each kind', async () => {
    await addSubscriber('a@example.com', true);
    await processStatusSubscriberNotification(job({ kind: 'incident_resolved', status: 'resolved' }));
    expect(sendMail.mock.calls[0][0].subject).toBe(`[${ctx.project.name}] Resolved: API errors`);
    sendMail.mockClear();
    await processStatusSubscriberNotification(
      job({
        kind: 'maintenance_scheduled',
        status: undefined,
        scheduledStart: '2026-11-01T10:00:00.000Z',
        scheduledEnd: '2026-11-01T12:00:00.000Z',
      })
    );
    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toContain('Scheduled maintenance: API errors');
    expect(mail.text).toContain('Sun, 01 Nov 2026 10:00:00 GMT');
  });

  it('strips newlines from the subject', async () => {
    await addSubscriber('a@example.com', true);
    await processStatusSubscriberNotification(job({ title: 'Line one\r\nBcc: evil@example.com' }));
    expect(sendMail.mock.calls[0][0].subject).not.toMatch(/[\r\n]/);
  });
});

describe('enqueueStatusSubscriberNotification', () => {
  const originalError = console.error;
  afterEach(() => {
    console.error = originalError;
  });

  it('adds the job to the queue', async () => {
    await enqueueStatusSubscriberNotification(job().data);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd.mock.calls[0][1]).toMatchObject({ kind: 'incident_created', title: 'API errors' });
  });

  it('swallows a queue failure', async () => {
    console.error = vi.fn();
    queueAdd.mockRejectedValue(new Error('redis down'));
    await expect(enqueueStatusSubscriberNotification(job().data)).resolves.toBeUndefined();
  });
});
