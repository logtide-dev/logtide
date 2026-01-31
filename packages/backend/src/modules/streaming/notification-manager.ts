/**
 * Notification Manager
 *
 * Manages PostgreSQL LISTEN/NOTIFY subscriptions for real-time log streaming.
 * Maintains a single dedicated PG client for listening to log notifications.
 */

import pg from 'pg';
import { EventEmitter } from 'events';

const { Client } = pg;

/**
 * Log notification event payload
 */
export interface LogNotificationEvent {
  projectId: string;
  logIds: string[];
  timestamp: string;
}

/**
 * Subscriber interface for WebSocket handlers
 */
export interface LogSubscriber {
  /** Unique subscriber ID (e.g., WebSocket connection ID) */
  id: string;
  /** Filter: only receive logs for this project */
  projectId: string;
  /** Optional filter: specific services */
  services?: string[];
  /** Optional filter: specific log levels */
  levels?: string[];
  /** Callback when notification received */
  onNotification: (event: LogNotificationEvent) => Promise<void>;
}

/**
 * Notification Manager
 *
 * Singleton service that manages PostgreSQL LISTEN/NOTIFY subscriptions.
 */
export class NotificationManager extends EventEmitter {
  private static instance: NotificationManager | null = null;

  private client: pg.Client | null = null;
  private subscribers: Map<string, LogSubscriber> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private isShuttingDown = false;
  private databaseUrl: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  private constructor() {
    super();
  }

  static getInstance(): NotificationManager {
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager();
    }
    return NotificationManager.instance;
  }

  /**
   * Initialize LISTEN connection
   *
   * @param databaseUrl PostgreSQL connection string
   */
  async initialize(databaseUrl: string): Promise<void> {
    if (this.client) {
      console.warn('[NotificationManager] Already initialized');
      return;
    }

    this.databaseUrl = databaseUrl;
    await this.connect();
  }

  /**
   * Connect to PostgreSQL and start listening
   */
  private async connect(): Promise<void> {
    if (!this.databaseUrl) {
      throw new Error('[NotificationManager] Database URL not set');
    }

    try {
      this.client = new Client({
        connectionString: this.databaseUrl,
        application_name: `logtide-notify-${process.pid}`,
      });

      // Setup error handler before connecting
      this.client.on('error', (err) => {
        console.error('[NotificationManager] Client error:', err.message);
        this.handleDisconnect();
      });

      // Setup notification handler
      this.client.on('notification', (msg) => {
        this.handleNotification(msg);
      });

      // Connect
      await this.client.connect();
      console.log('[NotificationManager] Connected to PostgreSQL');

      // Start listening
      await this.client.query('LISTEN logs_new');
      console.log('[NotificationManager] Listening to logs_new channel');

      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');
    } catch (error) {
      console.error('[NotificationManager] Failed to connect:', error);
      this.client = null;
      this.scheduleReconnect();
    }
  }

  /**
   * Subscribe to log notifications
   *
   * @param subscriber Subscriber configuration
   * @returns Unsubscribe function
   */
  subscribe(subscriber: LogSubscriber): () => void {
    this.subscribers.set(subscriber.id, subscriber);
    console.log(
      `[NotificationManager] Subscriber added: ${subscriber.id} (project: ${subscriber.projectId})`
    );
    console.log(`[NotificationManager] Total subscribers: ${this.subscribers.size}`);

    // Return unsubscribe function
    return () => {
      this.unsubscribe(subscriber.id);
    };
  }

  /**
   * Unsubscribe from notifications
   */
  unsubscribe(subscriberId: string): void {
    const existed = this.subscribers.delete(subscriberId);
    if (existed) {
      console.log(`[NotificationManager] Subscriber removed: ${subscriberId}`);
      console.log(`[NotificationManager] Total subscribers: ${this.subscribers.size}`);
    }
  }

  /**
   * Handle incoming NOTIFY message
   */
  private handleNotification(msg: pg.Notification): void {
    if (msg.channel !== 'logs_new' || !msg.payload) {
      return;
    }

    try {
      const event: LogNotificationEvent = JSON.parse(msg.payload);

      // Find matching subscribers (filter by projectId)
      const matchingSubscribers = Array.from(this.subscribers.values()).filter(
        (sub) => sub.projectId === event.projectId
      );

      if (matchingSubscribers.length === 0) {
        // No subscribers for this project - skip
        return;
      }

      // Dispatch to all matching subscribers (in parallel)
      Promise.all(
        matchingSubscribers.map((sub) =>
          sub.onNotification(event).catch((err) => {
            console.error(
              `[NotificationManager] Error in subscriber ${sub.id}:`,
              err.message
            );
          })
        )
      );
    } catch (error) {
      console.error('[NotificationManager] Failed to parse notification:', error);
    }
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnect(): void {
    this.isConnected = false;
    this.emit('disconnected');

    if (this.client) {
      this.client.removeAllListeners();
      this.client.end().catch(() => {});
      this.client = null;
    }

    if (!this.isShuttingDown) {
      console.warn('[NotificationManager] Disconnected, scheduling reconnect...');
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isShuttingDown) {
      return;
    }

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error('[NotificationManager] Max reconnect attempts reached');
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, ... up to 30s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    console.log(
      `[NotificationManager] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        console.error('[NotificationManager] Reconnect failed:', err);
      });
    }, delay);
  }

  /**
   * Shutdown gracefully
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      try {
        await this.client.query('UNLISTEN logs_new');
        await this.client.end();
        console.log('[NotificationManager] Client closed');
      } catch (error) {
        console.error('[NotificationManager] Error during shutdown:', error);
      }
      this.client = null;
    }

    this.subscribers.clear();
    this.isConnected = false;
  }

  /**
   * Get current connection status
   */
  getStatus(): { connected: boolean; subscriberCount: number } {
    return {
      connected: this.isConnected,
      subscriberCount: this.subscribers.size,
    };
  }

  /**
   * Check if connected
   */
  isReady(): boolean {
    return this.isConnected;
  }
}

export const notificationManager = NotificationManager.getInstance();
