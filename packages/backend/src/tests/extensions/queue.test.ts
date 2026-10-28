/**
 * Extension jobs, crons and mail: registration, enqueue through the real
 * queue backend, and SMTP delivery via mailhog.
 */
import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'crypto';
import { config } from '../../config/index.js';
import { startExtensionJobs } from '../../extensions/jobs.js';
import { initExtensions } from '../../extensions/runtime.js';
import { MailNotConfiguredError } from '../../extensions/types.js';
import type { ExtensionApi, LogtideExtension } from '../../extensions/types.js';

const cfg = config as { SMTP_HOST?: string };

function captureFixture(register?: (api: ExtensionApi) => void): { mod: LogtideExtension; api: () => ExtensionApi } {
  let captured: ExtensionApi | undefined;
  return {
    mod: {
      name: 'fixture',
      apiVersion: 1,
      register(api) {
        captured = api;
        register?.(api);
      },
    },
    api: () => captured!,
  };
}

async function waitFor<T>(fn: () => T | undefined | Promise<T | undefined>, tries = 100): Promise<T | undefined> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

describe('extension queue', () => {
  const workers: Array<{ close(): Promise<void> }> = [];
  const smtpHost = cfg.SMTP_HOST;

  afterEach(async () => {
    cfg.SMTP_HOST = smtpHost;
    await Promise.all(workers.splice(0).map((w) => w.close()));
  });

  it('registerJob and schedule produce a job and a cron named ext:<name>:<job>', async () => {
    const fx = captureFixture((api) => {
      api.queue.registerJob('ping', async () => {});
      api.queue.schedule('ping', '0 * * * *');
    });
    const runtime = await initExtensions([fx.mod], 'worker');

    expect(runtime.jobs).toHaveLength(1);
    expect(runtime.jobs[0].queue).toBe('ext:fixture:ping');
    expect(runtime.crons).toEqual([
      { task: 'ext:fixture:ping', cronExpression: '0 * * * *', payload: {}, identifier: 'ext:fixture:ping' },
    ]);
  });

  it('rejects a job registered twice', async () => {
    const fx = captureFixture((api) => {
      api.queue.registerJob('ping', async () => {});
      api.queue.registerJob('ping', async () => {});
    });
    await expect(initExtensions([fx.mod], 'worker')).rejects.toThrow(/more than once/);
  });

  it('schedule and registerJob after init throw', async () => {
    const fx = captureFixture();
    await initExtensions([fx.mod], 'worker');
    expect(() => fx.api().queue.schedule('ping', '0 * * * *')).toThrow(
      '[Extensions] schedule() must be called inside register()'
    );
    expect(() => fx.api().queue.registerJob('ping', async () => {})).toThrow(
      '[Extensions] registerJob() must be called inside register()'
    );
  });

  it('enqueue runs the handler with the data through a worker', async () => {
    const job = `ping_${crypto.randomUUID().slice(0, 8)}`;
    const received: unknown[] = [];
    const fx = captureFixture((api) => {
      api.queue.registerJob<{ n: number }>(job, async (data) => {
        received.push(data);
      });
    });
    const runtime = await initExtensions([fx.mod], 'worker');
    workers.push(...(await startExtensionJobs(runtime)));

    await fx.api().queue.enqueue(job, { n: 1 });

    expect(await waitFor(() => received[0])).toEqual({ n: 1 });
  });
});

describe('extension mail', () => {
  const smtpHost = cfg.SMTP_HOST;
  afterEach(() => {
    cfg.SMTP_HOST = smtpHost;
  });

  it('send throws MailNotConfiguredError without SMTP_HOST', async () => {
    const fx = captureFixture();
    await initExtensions([fx.mod], 'server');
    cfg.SMTP_HOST = undefined;
    await expect(
      fx.api().mail.send({ to: 'a@example.com', subject: 's', text: 't' })
    ).rejects.toBeInstanceOf(MailNotConfiguredError);
  });

  it('send delivers through SMTP (mailhog)', async () => {
    const fx = captureFixture();
    await initExtensions([fx.mod], 'server');
    const to = `ext-mail-${crypto.randomUUID()}@example.com`;
    await fx.api().mail.send({ to, subject: 'hello ext', text: 'plain body' });

    const item = await waitFor(async () => {
      const res = await fetch(`http://localhost:8025/api/v2/search?kind=to&query=${encodeURIComponent(to)}`);
      const data = (await res.json()) as {
        items: Array<{ Content: { Headers: { Subject: string[]; From: string[] } } }>;
      };
      return data.items[0];
    });
    expect(item?.Content.Headers.Subject[0]).toBe('hello ext');
    expect(item?.Content.Headers.From[0]).toBe(config.SMTP_FROM);
  });
});
