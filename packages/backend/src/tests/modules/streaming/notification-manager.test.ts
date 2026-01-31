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

    it('should handle subscriber callback errors gracefully', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const onNotification = vi.fn().mockRejectedValue(new Error('Subscriber error'));
      const subscriber = {
        id: 'sub-error',
        projectId: 'project-123',
        onNotification,
      };

      manager.subscribe(subscriber);

      const notification = {
        channel: 'logs_new',
        payload: JSON.stringify({
          projectId: 'project-123',
          logIds: ['log-1'],
          timestamp: new Date().toISOString(),
        }),
      };

      // Should not throw even if subscriber throws
      (manager as any).handleNotification(notification);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onNotification).toHaveBeenCalled();
    });

    it('should dispatch to multiple matching subscribers', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const onNotification1 = vi.fn().mockResolvedValue(undefined);
      const onNotification2 = vi.fn().mockResolvedValue(undefined);

      manager.subscribe({
        id: 'sub-1',
        projectId: 'project-123',
        onNotification: onNotification1,
      });

      manager.subscribe({
        id: 'sub-2',
        projectId: 'project-123',
        onNotification: onNotification2,
      });

      const notification = {
        channel: 'logs_new',
        payload: JSON.stringify({
          projectId: 'project-123',
          logIds: ['log-1'],
          timestamp: new Date().toISOString(),
        }),
      };

      (manager as any).handleNotification(notification);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onNotification1).toHaveBeenCalled();
      expect(onNotification2).toHaveBeenCalled();
    });

    it('should skip when no payload', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const onNotification = vi.fn().mockResolvedValue(undefined);
      manager.subscribe({
        id: 'sub-no-payload',
        projectId: 'project-123',
        onNotification,
      });

      const notification = {
        channel: 'logs_new',
        payload: undefined,
      };

      (manager as any).handleNotification(notification);

      expect(onNotification).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should emit disconnected event', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      const disconnectHandler = vi.fn();
      manager.on('disconnected', disconnectHandler);

      (manager as any).handleDisconnect();

      expect(disconnectHandler).toHaveBeenCalled();
      expect(manager.getStatus().connected).toBe(false);
    });
  });

  describe('scheduleReconnect', () => {
    it('should not schedule if already shutting down', async () => {
      await manager.initialize('postgresql://test@localhost/test');
      (manager as any).isShuttingDown = true;

      (manager as any).scheduleReconnect();

      // Should not throw and should not schedule
      expect(manager.getStatus().connected).toBe(true);
    });

    it('should not schedule if reconnect already pending', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      // First schedule
      (manager as any).scheduleReconnect();

      // Second schedule should be ignored
      (manager as any).scheduleReconnect();

      // Clean up timer
      if ((manager as any).reconnectTimer) {
        clearTimeout((manager as any).reconnectTimer);
        (manager as any).reconnectTimer = null;
      }
    });
  });

  describe('connect', () => {
    it('should throw error if database URL not set', async () => {
      await expect((manager as any).connect()).rejects.toThrow('Database URL not set');
    });

    it('should emit connected event on successful connection', async () => {
      const connectHandler = vi.fn();
      manager.on('connected', connectHandler);

      await manager.initialize('postgresql://test@localhost/test');

      expect(connectHandler).toHaveBeenCalled();
    });
  });

  describe('scheduleReconnect (max attempts)', () => {
    it('should stop reconnecting after max attempts', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      // Set reconnect attempts to max
      (manager as any).reconnectAttempts = 10;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      (manager as any).scheduleReconnect();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[NotificationManager] Max reconnect attempts reached'
      );

      consoleSpy.mockRestore();
    });

    it('should calculate exponential backoff delay', async () => {
      await manager.initialize('postgresql://test@localhost/test');
      (manager as any).isShuttingDown = false;

      // First attempt
      (manager as any).reconnectAttempts = 0;
      (manager as any).scheduleReconnect();

      // Clean up timer
      if ((manager as any).reconnectTimer) {
        clearTimeout((manager as any).reconnectTimer);
        (manager as any).reconnectTimer = null;
      }

      // Verify attempts incremented
      expect((manager as any).reconnectAttempts).toBe(1);
    });
  });

  describe('handleDisconnect edge cases', () => {
    it('should not schedule reconnect when shutting down', async () => {
      await manager.initialize('postgresql://test@localhost/test');
      (manager as any).isShuttingDown = true;

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      (manager as any).handleDisconnect();

      // Should not log reconnect message
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('scheduling reconnect')
      );

      consoleSpy.mockRestore();
    });

    it('should clean up client on disconnect', async () => {
      await manager.initialize('postgresql://test@localhost/test');

      (manager as any).handleDisconnect();

      expect((manager as any).client).toBeNull();
      expect(manager.getStatus().connected).toBe(false);
    });
  });
});
