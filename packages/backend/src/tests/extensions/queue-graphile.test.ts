/**
 * startExtensionJobs on the graphile-worker backend (selected by unsetting
 * REDIS_URL before the queue system initializes).
 */
import { describe, it, expect, vi } from 'vitest';

describe('startExtensionJobs on graphile', () => {
  it('keeps the digest cron when extension crons are registered', async () => {
    // The setup files may have loaded the queue system with Redis already.
    vi.resetModules();
    vi.doMock('../../config/index.js', async (importOriginal) => {
      const orig = await importOriginal<typeof import('../../config/index.js')>();
      return { ...orig, config: { ...orig.config, REDIS_URL: undefined } };
    });
    const { getQueueBackend } = await import('../../queue/connection.js');
    const { getCronRegistry } = await import('../../queue/queue-factory.js');
    const { GraphileWorkerManager } = await import('../../queue/adapters/graphile-adapter.js');
    const { startExtensionJobs } = await import('../../extensions/jobs.js');
    const { initExtensions } = await import('../../extensions/runtime.js');
    expect(getQueueBackend()).toBe('graphile');

    await getCronRegistry('digest-dispatch').registerCronJobs([
      { task: 'digest-dispatch', cronExpression: '0 * * * *', payload: {}, identifier: 'digest-dispatch' },
    ]);

    const runtime = await initExtensions(
      [
        {
          name: 'fixture',
          apiVersion: 1,
          register(api) {
            api.queue.registerJob('a', async () => {});
            api.queue.registerJob('b', async () => {});
            api.queue.schedule('a', '0 * * * *');
            api.queue.schedule('b', '5 * * * *');
          },
        },
      ],
      'worker'
    );
    const workers = await startExtensionJobs(runtime);

    expect(workers.map((w) => w.name).sort()).toEqual(['ext:fixture:a', 'ext:fixture:b']);
    const ids = GraphileWorkerManager.getInstance()
      .getCronItems()
      .map((i) => i.identifier)
      .sort();
    expect(ids).toEqual(['digest-dispatch', 'ext:fixture:a', 'ext:fixture:b']);

    // Re-registering an identifier replaces only itself.
    await getCronRegistry('ext:fixture:a').registerCronJobs([
      { task: 'ext:fixture:a', cronExpression: '10 * * * *', payload: {}, identifier: 'ext:fixture:a' },
    ]);
    expect(GraphileWorkerManager.getInstance().getCronItems()).toHaveLength(3);
  });
});
