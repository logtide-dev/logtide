import type { FastifyPluginAsync } from 'fastify';
import { db } from '../../database/index.js';
import type { LogLevel } from '@logtide/shared';
import {
  notificationManager,
  type LogNotificationEvent,
  type LogSubscriber,
} from '../streaming/index.js';
import { randomUUID } from 'crypto';

/**
 * WebSocket routes for real-time log streaming.
 *
 * Uses PostgreSQL LISTEN/NOTIFY for real-time notifications.
 * When a notification is received, fetches full logs from database
 * and sends to the WebSocket client after applying filters.
 *
 * Rate limiting note: WebSocket connections are long-lived and authenticated.
 * Connection rate is implicitly limited by authentication requirements.
 */
const websocketRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/logs/ws', { websocket: true }, async (socket, req: any) => {
    const { projectId, service, level, token } = req.query as {
      projectId: string;
      service?: string | string[];
      level?: LogLevel | LogLevel[];
      token?: string;
    };

    // Verify authentication token
    if (!token) {
      socket.close(1008, 'Authentication token required');
      return;
    }

    // Verify session token (reuse session validation logic)
    try {
      const session = await db
        .selectFrom('sessions')
        .innerJoin('users', 'users.id', 'sessions.user_id')
        .selectAll('users')
        .select('sessions.expires_at')
        .where('sessions.token', '=', token)
        .executeTakeFirst();

      if (!session || new Date(session.expires_at) < new Date()) {
        socket.close(1008, 'Invalid or expired authentication token');
        return;
      }
    } catch (error) {
      console.error('[WebSocket] Authentication error:', error);
      socket.close(1011, 'Internal Server Error');
      return;
    }

    if (!projectId) {
      socket.close(1008, 'ProjectId required');
      return;
    }

    // Generate unique subscriber ID
    const subscriberId = randomUUID();

    // Parse filter arrays
    const serviceFilter = service
      ? Array.isArray(service)
        ? service
        : [service]
      : undefined;
    const levelFilter = level ? (Array.isArray(level) ? level : [level]) : undefined;

    // Track socket state for safe sending
    let isSocketOpen = true;

    // Helper function to safely send data to WebSocket
    const safeSend = (data: string): boolean => {
      if (!isSocketOpen || socket.readyState !== 1) { // 1 = OPEN
        return false;
      }
      try {
        socket.send(data);
        return true;
      } catch (error) {
        console.error(`[WebSocket:${subscriberId}] Send error:`, error);
        return false;
      }
    };

    // Define subscriber for PostgreSQL LISTEN/NOTIFY
    const subscriber: LogSubscriber = {
      id: subscriberId,
      projectId,
      services: serviceFilter,
      levels: levelFilter,

      // Notification handler: fetch logs and send to WebSocket
      onNotification: async (event: LogNotificationEvent) => {
        // Skip if socket is no longer open
        if (!isSocketOpen) {
          return;
        }

        try {
          // Fetch full logs from database (by log IDs)
          // This query is fast because:
          // 1. PostgreSQL shared buffers likely cached recent inserts
          // 2. Log IDs are primary keys (indexed)
          const logs = await db
            .selectFrom('logs')
            .selectAll()
            .where('id', 'in', event.logIds)
            .where('project_id', '=', projectId)
            .execute();

          if (logs.length === 0) {
            return;
          }

          // Apply client-side filters (service, level)
          const filteredLogs = logs.filter((log) => {
            // Service filter
            if (serviceFilter && !serviceFilter.includes(log.service)) {
              return false;
            }

            // Level filter
            if (levelFilter && !levelFilter.includes(log.level)) {
              return false;
            }

            return true;
          });

          if (filteredLogs.length === 0) {
            return;
          }

          // Transform to API format
          const apiLogs = filteredLogs.map((log) => ({
            id: log.id,
            time: log.time,
            projectId: log.project_id,
            service: log.service,
            level: log.level,
            message: log.message,
            metadata: log.metadata,
            traceId: log.trace_id,
            spanId: log.span_id,
          }));

          // Send to WebSocket client (safe send checks socket state)
          safeSend(JSON.stringify({ type: 'logs', logs: apiLogs }));
        } catch (error) {
          console.error(`[WebSocket:${subscriberId}] Error handling notification:`, error);
        }
      },
    };

    // Register subscriber with notification manager
    const unsubscribe = notificationManager.subscribe(subscriber);

    // Cleanup function to ensure proper resource release
    const cleanup = () => {
      if (!isSocketOpen) return; // Already cleaned up
      isSocketOpen = false;
      unsubscribe();
    };

    // Send initial connection message
    safeSend(JSON.stringify({ type: 'connected', subscriberId }));

    // Cleanup on disconnect
    socket.on('close', () => {
      console.log(`[WebSocket] Client disconnected: ${subscriberId}`);
      cleanup();
    });

    socket.on('error', (err: Error) => {
      console.error(`[WebSocket] Socket error (${subscriberId}):`, err);
      cleanup();
      // Close the socket on error to prevent memory leaks
      try {
        socket.close();
      } catch {
        // Socket may already be closed
      }
    });
  });
};

export default websocketRoutes;
