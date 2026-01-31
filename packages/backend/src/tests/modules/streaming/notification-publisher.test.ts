import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationPublisher, notificationPublisher } from '../../../modules/streaming/notification-publisher.js';

describe('NotificationPublisher', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('getInstance', () => {
        it('should return singleton instance', () => {
            const instance1 = NotificationPublisher.getInstance();
            const instance2 = NotificationPublisher.getInstance();
            expect(instance1).toBe(instance2);
        });

        it('should be same as exported singleton', () => {
            const instance = NotificationPublisher.getInstance();
            expect(instance).toBe(notificationPublisher);
        });
    });

    describe('publishLogIngestion', () => {
        it('should not throw when logIds is empty', async () => {
            // Should complete without error
            await expect(
                notificationPublisher.publishLogIngestion('project-123', [])
            ).resolves.not.toThrow();
        });

        it('should log chunking message for large batches', async () => {
            // Create 250 log IDs (which is > MAX_LOG_IDS_PER_CHUNK ~197)
            const logIds = Array.from({ length: 250 }, (_, i) => `log-${i}`);

            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            // This will try to publish (and may fail if DB not connected in test)
            // but should log the chunking message
            await notificationPublisher.publishLogIngestion('project-123', logIds);

            // Should have logged about chunking
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Large batch')
            );

            consoleSpy.mockRestore();
            consoleErrorSpy.mockRestore();
        });

        it('should not throw on publish error', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            // Even if publish fails, should not throw
            await expect(
                notificationPublisher.publishLogIngestion('project-123', ['log-1'])
            ).resolves.not.toThrow();

            consoleErrorSpy.mockRestore();
        });
    });
});
