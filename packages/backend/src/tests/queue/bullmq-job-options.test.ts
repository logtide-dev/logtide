import { describe, it, expect } from 'vitest';
import { buildBullJobOptions } from '../../queue/adapters/bullmq-adapter.js';

/**
 * Regression test for the Redis memory leak: the BullMQ adapter must NOT pass
 * `removeOnComplete`/`removeOnFail` when the caller omits them, otherwise the
 * `undefined` values clobber the queue-level DEFAULT_JOB_OPTIONS during BullMQ's
 * Object.assign merge and disable job cleanup (completed/failed job hashes pile
 * up in Redis forever).
 */
describe('buildBullJobOptions', () => {
  it('omits removeOnComplete/removeOnFail when no options are given, so queue defaults survive', () => {
    const opts = buildBullJobOptions();

    // The keys must be ABSENT (not present-with-undefined), so Object.assign over
    // defaultJobOptions keeps the cleanup config.
    expect('removeOnComplete' in opts).toBe(false);
    expect('removeOnFail' in opts).toBe(false);
  });

  it('omits removeOnComplete/removeOnFail when options object lacks them', () => {
    const opts = buildBullJobOptions({ maxAttempts: 5, priority: 2 });

    expect('removeOnComplete' in opts).toBe(false);
    expect('removeOnFail' in opts).toBe(false);
    expect(opts.attempts).toBe(5);
    expect(opts.priority).toBe(2);
  });

  it('defaults attempts to 3 to match the graphile adapter', () => {
    expect(buildBullJobOptions().attempts).toBe(3);
  });

  it('passes through removeOnComplete/removeOnFail when explicitly provided', () => {
    const opts = buildBullJobOptions({ removeOnComplete: false, removeOnFail: true });

    expect(opts.removeOnComplete).toBe(false);
    expect(opts.removeOnFail).toBe(true);
  });

  it('maps jobKey to jobId', () => {
    expect(buildBullJobOptions({ jobKey: 'abc' }).jobId).toBe('abc');
  });
});
