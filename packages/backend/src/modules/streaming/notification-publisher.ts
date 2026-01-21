/**
 * Notification Publisher
 *
 * Publishes lightweight metadata notifications after log ingestion using PostgreSQL NOTIFY.
 * Payload contains only metadata (projectId + logIds) to stay under 8KB limit.
 */

import { db } from '../../database/index.js';
import { sql } from 'kysely';

/**
 * Maximum payload size for PostgreSQL NOTIFY (8KB minus safety margin)
 */
const MAX_PAYLOAD_SIZE = 7900;

/**
 * Approximate size per log ID (UUID + JSON overhead)
 */
const BYTES_PER_LOG_ID = 40;

/**
 * Maximum log IDs per chunk based on payload size
 */
const MAX_LOG_IDS_PER_CHUNK = Math.floor(MAX_PAYLOAD_SIZE / BYTES_PER_LOG_ID);

/**
 * Notification Publisher
 *
 * Singleton service for publishing log ingestion notifications.
 */
export class NotificationPublisher {
  private static instance: NotificationPublisher | null = null;

  private constructor() {}

  static getInstance(): NotificationPublisher {
    if (!NotificationPublisher.instance) {
      NotificationPublisher.instance = new NotificationPublisher();
    }
    return NotificationPublisher.instance;
  }

  /**
   * Publish log ingestion notification
   *
   * Sends NOTIFY with metadata (projectId + logIds).
   * Automatically chunks if payload exceeds PostgreSQL limit.
   *
   * @param projectId Project ID
   * @param logIds Array of inserted log IDs
   */
  async publishLogIngestion(projectId: string, logIds: string[]): Promise<void> {
    if (logIds.length === 0) {
      return;
    }

    try {
      // Check if chunking is needed
      if (logIds.length > MAX_LOG_IDS_PER_CHUNK) {
        console.log(
          `[NotificationPublisher] Large batch (${logIds.length} logs), chunking into ${Math.ceil(logIds.length / MAX_LOG_IDS_PER_CHUNK)} notifications`
        );

        // Send in chunks
        for (let i = 0; i < logIds.length; i += MAX_LOG_IDS_PER_CHUNK) {
          const chunk = logIds.slice(i, i + MAX_LOG_IDS_PER_CHUNK);
          await this.sendNotification(projectId, chunk);
        }
      } else {
        await this.sendNotification(projectId, logIds);
      }
    } catch (error) {
      // Log error but don't throw - ingestion should succeed even if streaming fails
      console.error('[NotificationPublisher] Failed to publish notification:', error);
    }
  }

  /**
   * Send a single NOTIFY command
   */
  private async sendNotification(projectId: string, logIds: string[]): Promise<void> {
    const payload = JSON.stringify({
      projectId,
      logIds,
      timestamp: new Date().toISOString(),
    });

    // Use Kysely parameterized query - the ${payload} is automatically escaped
    await sql`SELECT pg_notify('logs_new', ${payload})`.execute(db);
  }
}

export const notificationPublisher = NotificationPublisher.getInstance();
