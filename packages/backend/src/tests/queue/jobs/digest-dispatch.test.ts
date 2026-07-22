import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IJob } from '../../../queue/abstractions/types.js';

vi.mock('@logtide/core', () => ({
  hub: {
    captureLog: vi.fn(),
  },
}));

const mockAdd = vi.fn().mockResolvedValue({ id: 'job_1' });
vi.mock('../../../queue/connection.js', () => ({
  createQueue: vi.fn(() => ({
    add: mockAdd,
  })),
}));

const mockExecute = vi.fn();
vi.mock('../../../database/connection.js', () => ({
  db: {
    selectFrom: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    updateTable: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: (...args: unknown[]) => mockExecute(...args),
  },
}));

import { isConfigDue, processDigestDispatch } from '../../../queue/jobs/digest-dispatch.js';
import { db } from '../../../database/connection.js';

function makeJob(): IJob<Record<string, never>> {
  return { id: 'dispatch_1', name: 'digest-dispatch', data: {} };
}

describe('isConfigDue', () => {
  // 2026-07-13 is a Monday; 08:30 UTC
  const mondayAt8 = new Date('2026-07-13T08:30:00.000Z');

  const baseDaily = {
    frequency: 'daily' as const,
    delivery_hour: 8,
    delivery_day_of_week: null,
    last_sent_at: null,
  };

  it('daily config is due when the current UTC hour matches', () => {
    expect(isConfigDue(baseDaily, mondayAt8)).toBe(true);
  });

  it('daily config is not due on a different hour', () => {
    expect(isConfigDue({ ...baseDaily, delivery_hour: 9 }, mondayAt8)).toBe(false);
  });

  it('weekly config requires matching UTC day of week', () => {
    const weekly = { ...baseDaily, frequency: 'weekly' as const, delivery_day_of_week: 1 };
    expect(isConfigDue(weekly, mondayAt8)).toBe(true);
    expect(isConfigDue({ ...weekly, delivery_day_of_week: 2 }, mondayAt8)).toBe(false);
  });

  it('is not due again when last_sent_at is within the double-fire guard', () => {
    const sentRecently = { ...baseDaily, last_sent_at: new Date('2026-07-13T08:05:00.000Z') };
    expect(isConfigDue(sentRecently, mondayAt8)).toBe(false);
  });

  it('is due when last_sent_at is older than the guard window', () => {
    const sentYesterday = { ...baseDaily, last_sent_at: new Date('2026-07-12T08:30:00.000Z') };
    expect(isConfigDue(sentYesterday, mondayAt8)).toBe(true);
  });
});

describe('processDigestDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('enqueues generation jobs only for due configs and stamps last_sent_at', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T08:00:30.000Z'));

    mockExecute.mockResolvedValueOnce([
      {
        id: 'conf_due',
        organization_id: 'org_1',
        frequency: 'daily',
        delivery_hour: 8,
        delivery_day_of_week: null,
        last_sent_at: null,
      },
      {
        id: 'conf_not_due',
        organization_id: 'org_2',
        frequency: 'daily',
        delivery_hour: 20,
        delivery_day_of_week: null,
        last_sent_at: null,
      },
    ]);
    // updateTable(...).execute() resolves via the same mockExecute
    mockExecute.mockResolvedValue(undefined);

    await processDigestDispatch(makeJob());

    expect(mockAdd).toHaveBeenCalledTimes(1);
    const [jobName, payload, options] = mockAdd.mock.calls[0];
    expect(jobName).toBe('digest-generation');
    expect(payload).toEqual({
      organizationId: 'org_1',
      digestConfigId: 'conf_due',
      frequency: 'daily',
    });
    // hour-keyed jobKey dedupes double enqueues within the same hour
    expect(options.jobKey).toBe('digest:conf_due:2026-07-13T08');

    expect(db.updateTable).toHaveBeenCalledWith('digest_configs');
    vi.useRealTimers();
  });

  it('does nothing when no config is due', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T03:00:00.000Z'));

    mockExecute.mockResolvedValueOnce([
      {
        id: 'conf_1',
        organization_id: 'org_1',
        frequency: 'daily',
        delivery_hour: 8,
        delivery_day_of_week: null,
        last_sent_at: null,
      },
    ]);

    await processDigestDispatch(makeJob());

    expect(mockAdd).not.toHaveBeenCalled();
    expect(db.updateTable).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
