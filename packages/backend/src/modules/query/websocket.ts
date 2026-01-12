import type { FastifyPluginAsync } from 'fastify';
import { connection } from '../../queue/connection.js';
import { db } from '../../database/index.js';
import type { LogLevel } from '@logtide/shared';

interface LogMessage {
    projectId: string;
    logs: any[];
}

/**
 * WebSocket routes for real-time log streaming.
 * Rate limiting note: WebSocket connections are long-lived and authenticated.
 * Connection rate is implicitly limited by authentication requirements.
 * Message rate limiting is handled by Redis pub/sub throughput.
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

        // Subscribe to Redis channel
        const sub = connection.duplicate();

        sub.on('error', (err) => {
            console.error('[WebSocket] Redis subscriber error:', err);
        });

        sub.subscribe('logs:new', (err) => {
            if (err) {
                console.error('[WebSocket] Failed to subscribe to logs:new', err);
                socket.close(1011, 'Internal Server Error');
                return;
            }
        });

        sub.on('message', (channel, message) => {
            if (channel === 'logs:new') {
                try {
                    const data: LogMessage = JSON.parse(message);

                    // Filter by project
                    if (data.projectId !== projectId) {
                        return;
                    }

                    // Filter logs
                    const filteredLogs = data.logs.filter(log => {
                        // Service filter
                        if (service) {
                            if (Array.isArray(service)) {
                                if (!service.includes(log.service)) return false;
                            } else {
                                if (log.service !== service) return false;
                            }
                        }

                        // Level filter
                        if (level) {
                            if (Array.isArray(level)) {
                                if (!level.includes(log.level)) return false;
                            } else {
                                if (log.level !== level) return false;
                            }
                        }

                        return true;
                    });

                    if (filteredLogs.length > 0) {
                        socket.send(JSON.stringify({ type: 'logs', logs: filteredLogs }));
                    }
                } catch (e) {
                    console.error('[WebSocket] Error processing log message:', e);
                }
            }
        });

        socket.on('close', () => {
            sub.unsubscribe('logs:new');
            sub.disconnect();
        });

        socket.on('error', (err: Error) => {
            console.error('[WebSocket] Socket error:', err);
            sub.unsubscribe('logs:new');
            sub.disconnect();
        });
    });
};

export default websocketRoutes;
