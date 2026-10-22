import type { FastifyPluginAsync } from 'fastify';
import { db } from '../../database/index.js';
import { reservoir } from '../../database/reservoir.js';
import type { LogLevel } from '@logtide/shared';
import {
  createLiveTailFilter,
  notificationManager,
  type LiveTailLog,
  type LogNotificationEvent,
  type LogSubscriber,
} from '../streaming/index.js';
import { randomUUID } from 'crypto';
import { verifyProjectAccess } from '../auth/verify-project-access.js';
import { buildLogFilter, LogQueryError, type SearchMode } from './build-log-filter.js';
import { mapApiLog } from './service.js';

const asList = <T>(value: T | T[] | undefined): T[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

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
  fastify.get('/api/v1/logs/ws', {
    websocket: true,
    // Rate-limit the connection upgrade: the handler does a session lookup and a
    // project-membership check (DB), so cap the connection attempt rate per client.
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (socket, req: any) => {
    const { projectId, service, level, hostname, token, q, searchMode } = req.query as {
      projectId: string;
      service?: string | string[];
      level?: LogLevel | LogLevel[];
      hostname?: string | string[];
      token?: string;
      q?: string | string[];
      searchMode?: string | string[];
    };

    if (!projectId) {
      socket.close(1008, 'ProjectId required');
      return;
    }

    // The auth plugin runs onRequest for this upgrade and authenticates via the
    // single-use stream ticket (?ticket=) or a legacy session token (?token=),
    // attaching the user to the request. Prefer that. Fall back to validating a
    // session token directly only if no user was attached. Either way, verify the
    // authenticated user actually has access to the requested project: the REST
    // log/trace/metric routes all gate on verifyProjectAccess; without the same
    // check here, any authenticated user could live-tail any project's logs by
    // passing a foreign projectId (cross-tenant leak).
    try {
      let userId: string | undefined = (req as any).user?.id;

      if (!userId) {
        if (!token) {
          socket.close(1008, 'Authentication required');
          return;
        }

        const session = await db
          .selectFrom('sessions')
          .innerJoin('users', 'users.id', 'sessions.user_id')
          .select(['users.id as userId', 'sessions.expires_at'])
          .where('sessions.token', '=', token)
          .executeTakeFirst();

        if (!session || new Date(session.expires_at) < new Date()) {
          socket.close(1008, 'Invalid or expired authentication token');
          return;
        }

        userId = session.userId;
      }

      const hasAccess = await verifyProjectAccess(projectId, userId);
      if (!hasAccess) {
        socket.close(1008, 'Access denied for the requested project');
        return;
      }
    } catch (error) {
      console.error('[WebSocket] Authentication error:', error);
      socket.close(1011, 'Internal Server Error');
      return;
    }

    // Generate unique subscriber ID
    const subscriberId = randomUUID();

    // Parse filter arrays
    const serviceFilter = asList(service);
    const levelFilter = asList(level);
    const hostnameFilter = asList(hostname);

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

    // Compile q with the same parser and limits as the REST endpoints, so the
    // socket reports the same error text. A query that does not compile closes
    // the socket: it never falls back to streaming unfiltered logs.
    const rejectQuery = (error: string, position: number) => {
      safeSend(JSON.stringify({ type: 'error', error, position }));
      socket.close(1008, 'Invalid query');
    };
    if (q !== undefined && typeof q !== 'string') {
      rejectQuery('q must be a single string', 0);
      return;
    }
    if (searchMode !== undefined && searchMode !== 'fulltext' && searchMode !== 'substring') {
      rejectQuery('searchMode must be fulltext or substring', 0);
      return;
    }

    let matchesFilters: (log: LiveTailLog) => boolean;
    try {
      const built = buildLogFilter({
        q,
        searchMode: searchMode as SearchMode | undefined,
        service: serviceFilter,
        level: levelFilter,
        hostname: hostnameFilter,
      });
      matchesFilters = createLiveTailFilter({
        services: serviceFilter,
        levels: levelFilter,
        hostnames: hostnameFilter,
        query: built.query,
      });
    } catch (err) {
      if (err instanceof LogQueryError) {
        rejectQuery(err.message, err.position);
        return;
      }
      console.error(`[WebSocket:${subscriberId}] Query compile error:`, err);
      socket.close(1011, 'Internal Server Error');
      return;
    }

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
          // This query is fast because log IDs are primary keys (indexed)
          const logs = await reservoir.getByIds({
            ids: event.logIds,
            projectId,
          });

          if (logs.length === 0) {
            return;
          }

          // Server-side filters: legacy service / level / hostname lists AND q
          const filteredLogs = logs.filter((log) => matchesFilters(log));

          if (filteredLogs.length === 0) {
            return;
          }

          // Same payload as the REST endpoints (hostname, spanId, sessionId included)
          const apiLogs = filteredLogs.map(mapApiLog);

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
