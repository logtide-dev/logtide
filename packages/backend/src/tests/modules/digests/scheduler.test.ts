import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DigestScheduler, DIGEST_DISPATCH_CRON } from '../../../modules/digests/scheduler.js';
import { getCronRegistry } from '../../../queue/queue-factory.js';

vi.mock('@logtide/core', () => ({
    hub: {
        captureLog: vi.fn(),
    },
}));

const mockRegisterCronJobs = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../queue/queue-factory.js', () => {
    return {
        getCronRegistry: vi.fn().mockReturnValue({
            registerCronJobs: (...args: unknown[]) => mockRegisterCronJobs(...args),
        }),
    };
});

describe('DigestScheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('registerDispatchCron', () => {
        it('registers a single hourly dispatch cron job', async () => {
            const scheduler = new DigestScheduler();
            await scheduler.registerDispatchCron();

            expect(getCronRegistry).toHaveBeenCalledWith('digest-dispatch');
            expect(mockRegisterCronJobs).toHaveBeenCalledTimes(1);

            const items = mockRegisterCronJobs.mock.calls[0][0];
            expect(items).toHaveLength(1);
            expect(items[0]).toEqual({
                task: 'digest-dispatch',
                cronExpression: DIGEST_DISPATCH_CRON,
                payload: {},
                identifier: 'digest-dispatch',
            });
        });

        it('uses an hourly cron expression', () => {
            expect(DIGEST_DISPATCH_CRON).toBe('0 * * * *');
        });
    });
});
