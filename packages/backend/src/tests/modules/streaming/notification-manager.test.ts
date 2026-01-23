import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NotificationManager } from '../../../modules/streaming/notification-manager.js';

// Mock pg Client
vi.mock('pg', () => {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  };
  return {
    default: {
      Client: vi.fn(() => mockClient),
    },
  };
});

describe('NotificationManager', () => {
  let manager: NotificationManager;

  beforeEach(() => {
    // Get a fresh instance by accessing the class directly
    // Reset the singleton for testing
    (NotificationManager as any).instance = null;
    manager = NotificationManager.getInstance();
  });

  afterEach(async () => {
    await manager.shutdown();
    vi.clearAllMocks();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = NotificationManager.getInstance();
      const instance2 = NotificationManager.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('initialize', () => {
    it('should initialize with database URL', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      // The warning is logged if already initialized
      expect(manager.getStatus().connected).toBe(true);
    });

    it('should not reinitialize if already initialized', async () => {
      await manager.initialize('postgresql://test@localhost/test');
      await manager.initialize('postgresql://test@localhost/test');

      // Should have logged warning but not thrown
      expect(manager.getStatus().connected).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('should add subscriber and return unsubscribe function', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const subscriber = {
        id: 'sub-1',
        projectId: 'project-123',
        onNotification: vi.fn().mockResolvedValue(undefined),
      };

      const unsubscribe = manager.subscribe(subscriber);

      expect(manager.getStatus().subscriberCount).toBe(1);
      expect(typeof unsubscribe).toBe('function');
    });

    it('should unsubscribe when function is called', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const subscriber = {
        id: 'sub-2',
        projectId: 'project-123',
        onNotification: vi.fn().mockResolvedValue(undefined),
      };

      const unsubscribe = manager.subscribe(subscriber);
      expect(manager.getStatus().subscriberCount).toBe(1);

      unsubscribe();
      expect(manager.getStatus().subscriberCount).toBe(0);
    });

    it('should allow multiple subscribers', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const sub1 = {
        id: 'sub-a',
        projectId: 'project-1',
        onNotification: vi.fn().mockResolvedValue(undefined),
      };

      const sub2 = {
        id: 'sub-b',
        projectId: 'project-2',
        onNotification: vi.fn().mockResolvedValue(undefined),
      };

      manager.subscribe(sub1);
      manager.subscribe(sub2);

      expect(manager.getStatus().subscriberCount).toBe(2);
    });
  });

  describe('unsubscribe', () => {
    it('should remove subscriber by id', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const subscriber = {
        id: 'sub-remove',
        projectId: 'project-123',
        onNotification: vi.fn().mockResolvedValue(undefined),
      };

      manager.subscribe(subscriber);
      expect(manager.getStatus().subscriberCount).toBe(1);

      manager.unsubscribe('sub-remove');
      expect(manager.getStatus().subscriberCount).toBe(0);
    });

    it('should handle non-existent subscriber gracefully', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      // Should not throw
      manager.unsubscribe('non-existent');
      expect(manager.getStatus().subscriberCount).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('should return correct status when not connected', () => {
      const status = manager.getStatus();

      expect(status.connected).toBe(false);
      expect(status.subscriberCount).toBe(0);
    });

    it('should return correct status when connected', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const subscriber = {
        id: 'sub-status',
        projectId: 'project-123',
        onNotification: vi.fn().mockResolvedValue(undefined),
      };
      manager.subscribe(subscriber);

      const status = manager.getStatus();

      expect(status.connected).toBe(true);
      expect(status.subscriberCount).toBe(1);
    });
  });

  describe('isReady', () => {
    it('should return false when not connected', () => {
      expect(manager.isReady()).toBe(false);
    });

    it('should return true when connected', async () => {
      await manager.initialize('postgresql://test@localhost/test');
      expect(manager.isReady()).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should clean up on shutdown', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const subscriber = {
        id: 'sub-shutdown',
        projectId: 'project-123',
        onNotification: vi.fn().mockResolvedValue(undefined),
      };
      manager.subscribe(subscriber);

      await manager.shutdown();

      expect(manager.getStatus().connected).toBe(false);
      expect(manager.getStatus().subscriberCount).toBe(0);
    });

    it('should handle shutdown when not initialized', async () => {
      // Should not throw
      await manager.shutdown();
      expect(manager.getStatus().connected).toBe(false);
    });
  });

  describe('handleNotification', () => {
    it('should dispatch notification to matching subscribers', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const onNotification = vi.fn().mockResolvedValue(undefined);
      const subscriber = {
        id: 'sub-notify',
        projectId: 'project-123',
        onNotification,
      };

      manager.subscribe(subscriber);

      // Simulate notification
      const notification = {
        channel: 'logs_new',
        payload: JSON.stringify({
          projectId: 'project-123',
          logIds: ['log-1', 'log-2'],
          timestamp: new Date().toISOString(),
        }),
      };

      // Access private method for testing
      (manager as any).handleNotification(notification);

      // Wait for async dispatch
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onNotification).toHaveBeenCalled();
    });

    it('should not dispatch to non-matching project subscribers', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const onNotification = vi.fn().mockResolvedValue(undefined);
      const subscriber = {
        id: 'sub-no-match',
        projectId: 'project-999',
        onNotification,
      };

      manager.subscribe(subscriber);

      const notification = {
        channel: 'logs_new',
        payload: JSON.stringify({
          projectId: 'project-123', // Different project
          logIds: ['log-1'],
          timestamp: new Date().toISOString(),
        }),
      };

      (manager as any).handleNotification(notification);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onNotification).not.toHaveBeenCalled();
    });

    it('should ignore non-logs_new channel', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const onNotification = vi.fn().mockResolvedValue(undefined);
      const subscriber = {
        id: 'sub-channel',
        projectId: 'project-123',
        onNotification,
      };

      manager.subscribe(subscriber);

      const notification = {
        channel: 'other_channel',
        payload: JSON.stringify({
          projectId: 'project-123',
          logIds: ['log-1'],
        }),
      };

      (manager as any).handleNotification(notification);

      expect(onNotification).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON payload gracefully', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const onNotification = vi.fn().mockResolvedValue(undefined);
      const subscriber = {
        id: 'sub-invalid',
        projectId: 'project-123',
        onNotification,
      };

      manager.subscribe(subscriber);

      const notification = {
        channel: 'logs_new',
        payload: 'invalid json {{{',
      };

      // Should not throw
      (manager as any).handleNotification(notification);

      expect(onNotification).not.toHaveBeenCalled();
    });
  });
});
