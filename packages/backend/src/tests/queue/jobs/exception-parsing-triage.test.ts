import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestUser, createTestOrganization, createTestProject, createTestLog } from '../../helpers/factories.js';

const mockState = {
  queueAdd: vi.fn().mockResolvedValue({ id: 'job-id' }),
};

// Mock queue connection BEFORE importing anything that uses it
vi.mock('../../../queue/connection.js', () => {
  return {
    createQueue: vi.fn(() => ({
      add: (...args: unknown[]) => mockState.queueAdd(...args),
      close: vi.fn(),
    })),
    createWorker: vi.fn(() => ({
      on: vi.fn(),
      close: vi.fn(),
    })),
    getConnection: () => null,
  };
});

vi.mock('../../../config/index.js', () => ({
  config: {
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    SMTP_SECURE: false,
    SMTP_USER: 'test@example.com',
    SMTP_PASS: 'password',
    SMTP_FROM: 'noreply@test.com',
    REDIS_URL: 'redis://localhost:6379',
  },
  isSmtpConfigured: vi.fn(() => false),
}));

import { processExceptionParsing, type ExceptionParsingJobData } from '../../../queue/jobs/exception-parsing.js';
import { ErrorGroupTriageService } from '../../../modules/exceptions/triage-service.js';
import type { Job } from 'bullmq';

const HOUR = 3600 * 1000;

type Frames = Array<{ file: string; function: string; line: number }>;

const FRAMES_A: Frames = [{ file: '/app/src/charge.js', function: 'charge', line: 10 }];

async function setup() {
  const owner = await createTestUser({ name: 'Owner User' });
  const org = await createTestOrganization({ ownerId: owner.id, name: 'Triage Org' });
  const project = await createTestProject({ organizationId: org.id, userId: owner.id });
  return { owner, org, project };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function makeJob(env: Env, frames: Frames = FRAMES_A, message = 'boom') {
  const log = await createTestLog({
    projectId: env.project.id,
    level: 'error',
    message: `TypeError: ${message}`,
    service: 'svc',
  });
  return {
    data: {
      logs: [
        {
          id: log.id,
          message: log.message,
          level: 'error' as const,
          service: 'svc',
          metadata: { exception: { type: 'TypeError', message, language: 'nodejs', stacktrace: frames } },
        },
      ],
      organizationId: env.org.id,
      projectId: env.project.id,
    } as ExceptionParsingJobData,
  } as Job<ExceptionParsingJobData>;
}

async function ingest(env: Env, frames: Frames = FRAMES_A, message = 'boom') {
  await processExceptionParsing(await makeJob(env, frames, message));
}

async function group(env: Env) {
  return db.selectFrom('error_groups').selectAll().where('organization_id', '=', env.org.id).executeTakeFirstOrThrow();
}

function payloads(): Array<Record<string, unknown>> {
  return mockState.queueAdd.mock.calls.map((c) => c[1] as Record<string, unknown>);
}

function resetQueue() {
  vi.clearAllMocks();
  mockState.queueAdd.mockResolvedValue({ id: 'job-id' });
}

describe('exception parsing: regression and ignore expiry', () => {
  beforeEach(() => {
    resetQueue();
  });

  it('a recurring resolved group reopens, sets regressed_at and notifies with isRegression', async () => {
    const env = await setup();
    await ingest(env);
    await db
      .updateTable('error_groups')
      .set({ status: 'resolved', resolved_at: new Date(), resolved_by: env.owner.id })
      .where('organization_id', '=', env.org.id)
      .execute();
    resetQueue();

    await ingest(env);

    const g = await group(env);
    expect(g.status).toBe('open');
    expect(g.regressed_at).not.toBeNull();
    expect(g.resolved_by).toBeNull();
    expect(g.resolved_at).toBeNull();
    const sent = payloads();
    expect(sent).toHaveLength(1);
    expect(sent[0].isRegression).toBe(true);
    expect(sent[0].isEscalating).toBeFalsy();
  });

  it('a second occurrence after the regression does not flag regression again', async () => {
    const env = await setup();
    await ingest(env);
    await db.updateTable('error_groups').set({ status: 'resolved' }).where('organization_id', '=', env.org.id).execute();
    await ingest(env);
    resetQueue();

    await ingest(env);

    const sent = payloads();
    expect(sent).toHaveLength(1);
    expect(sent[0].isRegression).toBe(false);
    expect((await group(env)).regressed_at).not.toBeNull();
  });

  it('an ignored group below its count stays ignored and increments ignored_event_count', async () => {
    const env = await setup();
    await ingest(env);
    await db
      .updateTable('error_groups')
      .set({ status: 'ignored', ignore_until_count: 5, ignored_event_count: 1 })
      .where('organization_id', '=', env.org.id)
      .execute();
    resetQueue();

    await ingest(env);

    const g = await group(env);
    expect(g.status).toBe('ignored');
    expect(g.ignored_event_count).toBe(2);
    expect(g.ignore_until_count).toBe(5);
    expect(payloads()[0].isEscalating).toBeFalsy();
  });

  it('an ignored group reaching ignore_until_count reopens, clears ignore fields and flags isEscalating', async () => {
    const env = await setup();
    await ingest(env);
    await db
      .updateTable('error_groups')
      .set({ status: 'ignored', ignore_until_count: 3, ignored_event_count: 2 })
      .where('organization_id', '=', env.org.id)
      .execute();
    resetQueue();

    await ingest(env);

    const g = await group(env);
    expect(g.status).toBe('open');
    expect(g.ignore_until_count).toBeNull();
    expect(g.ignored_until).toBeNull();
    expect(g.ignored_event_count).toBe(0);
    const sent = payloads();
    expect(sent[0].isEscalating).toBe(true);
    expect(sent[0].isRegression).toBe(false);
  });

  it('an ignored group past ignored_until reopens on the next occurrence and flags isEscalating', async () => {
    const env = await setup();
    await ingest(env);
    await db
      .updateTable('error_groups')
      .set({ status: 'ignored', ignored_until: new Date(Date.now() - HOUR), ignored_event_count: 4 })
      .where('organization_id', '=', env.org.id)
      .execute();
    resetQueue();

    await ingest(env);

    const g = await group(env);
    expect(g.status).toBe('open');
    expect(g.ignored_until).toBeNull();
    expect(g.ignored_event_count).toBe(0);
    expect(payloads()[0].isEscalating).toBe(true);
  });

  it('an ignored group before ignored_until stays ignored', async () => {
    const env = await setup();
    await ingest(env);
    await db
      .updateTable('error_groups')
      .set({ status: 'ignored', ignored_until: new Date(Date.now() + 24 * HOUR) })
      .where('organization_id', '=', env.org.id)
      .execute();
    resetQueue();

    await ingest(env);

    const g = await group(env);
    expect(g.status).toBe('ignored');
    expect(payloads()[0].isEscalating).toBeFalsy();
  });

  it('an ignored forever group never reopens and never flags escalation', async () => {
    const env = await setup();
    await ingest(env);
    await db.updateTable('error_groups').set({ status: 'ignored' }).where('organization_id', '=', env.org.id).execute();
    resetQueue();

    await ingest(env);
    await ingest(env);
    await ingest(env);

    const g = await group(env);
    expect(g.status).toBe('ignored');
    expect(g.ignored_event_count).toBe(3);
    for (const p of payloads()) expect(p.isEscalating).toBeFalsy();
  });

  it('parallel parse jobs at the threshold escalate exactly once', async () => {
    const env = await setup();
    await ingest(env);
    await db
      .updateTable('error_groups')
      .set({ status: 'ignored', ignore_until_count: 5, ignored_event_count: 4 })
      .where('organization_id', '=', env.org.id)
      .execute();
    resetQueue();

    const jobA = await makeJob(env);
    const jobB = await makeJob(env);
    await Promise.all([processExceptionParsing(jobA), processExceptionParsing(jobB)]);

    const escalating = payloads().filter((p) => p.isEscalating === true);
    expect(escalating).toHaveLength(1);
    const g = await group(env);
    expect(g.status).toBe('open');
  });

  it('regressed_at stays set while the group is open and manual resolve clears it', async () => {
    const env = await setup();
    await ingest(env);
    await db.updateTable('error_groups').set({ status: 'resolved' }).where('organization_id', '=', env.org.id).execute();
    await ingest(env);
    await ingest(env);
    expect((await group(env)).regressed_at).not.toBeNull();

    const triage = new ErrorGroupTriageService(db);
    const g = await group(env);
    await triage.updateErrorGroup(g.id, env.org.id, { status: 'resolved' }, env.owner.id);

    const after = await group(env);
    expect(after.status).toBe('resolved');
    expect(after.regressed_at).toBeNull();
  });

  it('auto-merge match into an ignored group counts against that group', async () => {
    const env = await setup();
    const framesA: Frames = [
      { file: '/app/src/charge.js', function: 'charge', line: 10 },
      { file: '/app/src/handlerA.js', function: 'handleA', line: 5 },
    ];
    const framesB: Frames = [
      { file: '/app/src/charge.js', function: 'charge', line: 10 },
      { file: '/app/src/handlerB.js', function: 'handleB', line: 7 },
    ];
    await ingest(env, framesA);
    await db
      .updateTable('error_groups')
      .set({ status: 'ignored', ignore_until_count: 5 })
      .where('organization_id', '=', env.org.id)
      .execute();
    resetQueue();

    await ingest(env, framesB);

    const groups = await db.selectFrom('error_groups').selectAll().where('organization_id', '=', env.org.id).execute();
    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBe('ignored');
    expect(groups[0].ignored_event_count).toBe(1);
  });
});
