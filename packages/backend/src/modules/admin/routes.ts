import type { FastifyInstance } from 'fastify';
import { adminService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import { requireAdmin } from './middleware.js';
import { auditLogService } from '../audit-log/index.js';

function parsePage(value: string | undefined, defaultVal = 1): number {
    const n = parseInt(value ?? String(defaultVal), 10);
    return isNaN(n) || n < 1 ? defaultVal : n;
}

function parseLimit(value: string | undefined, defaultVal = 50, max = 200): number {
    const n = parseInt(value ?? String(defaultVal), 10);
    return isNaN(n) || n < 1 ? defaultVal : Math.min(n, max);
}

export async function adminRoutes(fastify: FastifyInstance) {
    // All routes require session authentication + admin role
    fastify.addHook('onRequest', authenticate);
    fastify.addHook('onRequest', requireAdmin);

    // Apply rate limiting to admin routes (100 requests per minute)
    const rateLimitConfig = {
        max: 100,
        timeWindow: '1 minute',
    };

    // GET /api/v1/admin/stats/system - System-wide statistics
    fastify.get(
        '/stats/system',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const stats = await adminService.getSystemStats();
                return reply.send(stats);
            } catch (error) {
                console.error('Error getting system stats:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve system statistics',
                });
            }
        }
    );

    // GET /api/v1/admin/stats/database - Database statistics
    fastify.get(
        '/stats/database',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const stats = await adminService.getDatabaseStats();
                return reply.send(stats);
            } catch (error) {
                console.error('Error getting database stats:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve database statistics',
                });
            }
        }
    );

    // GET /api/v1/admin/stats/logs - Log statistics
    fastify.get(
        '/stats/logs',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const stats = await adminService.getLogsStats();
                return reply.send(stats);
            } catch (error) {
                console.error('Error getting logs stats:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve log statistics',
                });
            }
        }
    );

    // GET /api/v1/admin/stats/performance - Performance metrics
    fastify.get(
        '/stats/performance',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const stats = await adminService.getPerformanceStats();
                return reply.send(stats);
            } catch (error) {
                console.error('Error getting performance stats:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve performance statistics',
                });
            }
        }
    );

    // GET /api/v1/admin/stats/alerts - Alert system statistics
    fastify.get(
        '/stats/alerts',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const stats = await adminService.getAlertsStats();
                return reply.send(stats);
            } catch (error) {
                console.error('Error getting alerts stats:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve alert statistics',
                });
            }
        }
    );

    // GET /api/v1/admin/stats/redis - Redis statistics
    fastify.get(
        '/stats/redis',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const stats = await adminService.getRedisStats();
                return reply.send(stats);
            } catch (error) {
                console.error('Error getting redis stats:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve Redis statistics',
                });
            }
        }
    );

    // GET /api/v1/admin/stats/health - Health check
    fastify.get(
        '/stats/health',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const stats = await adminService.getHealthStats();
                return reply.send(stats);
            } catch (error) {
                console.error('Error getting health stats:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve health statistics',
                });
            }
        }
    );

    // GET /api/v1/admin/users - List all users with pagination and search
    fastify.get(
        '/users',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (request, reply) => {
            try {
                const { page, limit, search } = request.query as {
                    page?: string;
                    limit?: string;
                    search?: string;
                };

                const result = await adminService.getUsers(
                    parsePage(page),
                    parseLimit(limit),
                    search
                );

                return reply.send(result);
            } catch (error) {
                console.error('Error getting users:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve users',
                });
            }
        }
    );

    // GET /api/v1/admin/users/:id - Get user details
    fastify.get(
        '/users/:id',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (request, reply) => {
            try {
                const { id } = request.params as { id: string };
                const user = await adminService.getUserDetails(id);

                if (!user) {
                    return reply.status(404).send({
                        error: 'User not found',
                    });
                }

                return reply.send(user);
            } catch (error) {
                console.error('Error getting user details:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve user details',
                });
            }
        }
    );

    // PATCH /api/v1/admin/users/:id/status - Enable/Disable user
    fastify.patch(
        '/users/:id/status',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (request, reply) => {
            try {
                const { id } = request.params as { id: string };
                const { disabled } = request.body as { disabled: boolean };

                if (typeof disabled !== 'boolean') {
                    return reply.status(400).send({
                        error: 'disabled field must be a boolean',
                    });
                }

                const user = await adminService.updateUserStatus(id, disabled);

                auditLogService.log({
                    organizationId: null,
                    userId: (request as any).user?.id,
                    userEmail: (request as any).user?.email,
                    action: disabled ? 'disable_user' : 'enable_user',
                    category: 'user_management',
                    resourceType: 'user',
                    resourceId: id,
                    ipAddress: request.ip,
                    userAgent: request.headers['user-agent'],
                    metadata: { targetEmail: user.email },
                });

                return reply.send({
                    message: `User ${disabled ? 'disabled' : 'enabled'} successfully`,
                    user,
                });
            } catch (error) {
                console.error('Error updating user status:', error);
                return reply.status(500).send({
                    error: 'Failed to update user status',
                });
            }
        }
    );

    // PATCH /api/v1/admin/users/:id/role - Update user admin role
    fastify.patch(
        '/users/:id/role',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (request, reply) => {
            try {
                const { id } = request.params as { id: string };
                const { is_admin } = request.body as { is_admin: boolean };

                if (typeof is_admin !== 'boolean') {
                    return reply.status(400).send({
                        error: 'is_admin field must be a boolean',
                    });
                }

                // Prevent admin from demoting themselves
                const currentUser = (request as any).user;
                if (currentUser?.id === id && !is_admin) {
                    return reply.status(400).send({
                        error: 'Cannot remove admin role from yourself',
                    });
                }

                const user = await adminService.updateUserRole(id, is_admin);

                auditLogService.log({
                    organizationId: null,
                    userId: (request as any).user?.id,
                    userEmail: (request as any).user?.email,
                    action: 'update_user_role',
                    category: 'user_management',
                    resourceType: 'user',
                    resourceId: id,
                    ipAddress: request.ip,
                    userAgent: request.headers['user-agent'],
                    metadata: { is_admin, targetEmail: user.email },
                });

                return reply.send({
                    message: `User ${is_admin ? 'promoted to admin' : 'demoted from admin'} successfully`,
                    user,
                });
            } catch (error) {
                console.error('Error updating user role:', error);
                return reply.status(500).send({
                    error: 'Failed to update user role',
                });
            }
        }
    );

    // POST /api/v1/admin/users/:id/reset-password - Reset user password
    fastify.post(
        '/users/:id/reset-password',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (request, reply) => {
            try {
                const { id } = request.params as { id: string };
                const { newPassword } = request.body as { newPassword: string };

                if (!newPassword || newPassword.length < 8) {
                    return reply.status(400).send({
                        error: 'Password must be at least 8 characters long',
                    });
                }

                const user = await adminService.resetUserPassword(id, newPassword);

                auditLogService.log({
                    organizationId: null,
                    userId: (request as any).user?.id,
                    userEmail: (request as any).user?.email,
                    action: 'reset_user_password',
                    category: 'user_management',
                    resourceType: 'user',
                    resourceId: id,
                    ipAddress: request.ip,
                    userAgent: request.headers['user-agent'],
                    metadata: { targetEmail: user.email },
                });

                return reply.send({
                    message: 'Password reset successfully',
                    user,
                });
            } catch (error) {
                console.error('Error resetting password:', error);
                return reply.status(500).send({
                    error: 'Failed to reset password',
                });
            }
        }
    );

    // Organization Management Routes
    // GET /api/v1/admin/organizations - List organizations
    fastify.get(
        '/organizations',
        {
            preHandler: [authenticate, requireAdmin],
            config: {
                rateLimit: {
                    max: 100,
                    timeWindow: '1 minute',
                },
            },
        },
        async (request, reply) => {
            try {
                const { page = '1', limit = '50', search } = request.query as {
                    page?: string;
                    limit?: string;
                    search?: string;
                };

                const result = await adminService.getOrganizations(
                    parsePage(page),
                    parseLimit(limit),
                    search
                );

                return reply.send(result);
            } catch (error: any) {
                console.error('Error fetching organizations:', error);
                return reply.status(500).send({
                    error: 'Failed to fetch organizations',
                });
            }
        }
    );

    // GET /api/v1/admin/organizations/:id - Get organization details
    fastify.get(
        '/organizations/:id',
        {
            preHandler: [authenticate, requireAdmin],
            config: {
                rateLimit: {
                    max: 100,
                    timeWindow: '1 minute',
                },
            },
        },
        async (request, reply) => {
            try {
                const { id } = request.params as { id: string };
                const org = await adminService.getOrganizationDetails(id);
                return reply.send(org);
            } catch (error: any) {
                console.error('Error fetching organization details:', error);
                if (error.message === 'Organization not found') {
                    return reply.status(404).send({ error: error.message });
                }
                return reply.status(500).send({
                    error: 'Failed to fetch organization details',
                });
            }
        }
    );

    // DELETE /api/v1/admin/organizations/:id - Delete organization
    fastify.delete(
        '/organizations/:id',
        {
            preHandler: [authenticate, requireAdmin],
            config: {
                rateLimit: {
                    max: 100,
                    timeWindow: '1 minute',
                },
            },
        },
        async (request, reply) => {
            try {
                const { id } = request.params as { id: string };
                const result = await adminService.deleteOrganization(id);

                auditLogService.log({
                    organizationId: id,
                    userId: (request as any).user?.id,
                    userEmail: (request as any).user?.email,
                    action: 'admin_delete_organization',
                    category: 'data_modification',
                    resourceType: 'organization',
                    resourceId: id,
                    ipAddress: request.ip,
                    userAgent: request.headers['user-agent'],
                });

                return reply.send(result);
            } catch (error: any) {
                console.error('Error deleting organization:', error);
                return reply.status(500).send({
                    error: 'Failed to delete organization',
                });
            }
        }
    );

    // Project Management Routes
    // GET /api/v1/admin/projects - List projects
    fastify.get(
        '/projects',
        {
            preHandler: [authenticate, requireAdmin],
            config: {
                rateLimit: {
                    max: 100,
                    timeWindow: '1 minute',
                },
            },
        },
        async (request, reply) => {
            try {
                const { page = '1', limit = '50', search } = request.query as {
                    page?: string;
                    limit?: string;
                    search?: string;
                };

                const result = await adminService.getProjects(
                    parsePage(page),
                    parseLimit(limit),
                    search
                );

                return reply.send(result);
            } catch (error: any) {
                console.error('Error fetching projects:', error);
                return reply.status(500).send({
                    error: 'Failed to fetch projects',
                });
            }
        }
    );

    // GET /api/v1/admin/projects/:id - Get project details
    fastify.get(
        '/projects/:id',
        {
            preHandler: [authenticate, requireAdmin],
            config: {
                rateLimit: {
                    max: 100,
                    timeWindow: '1 minute',
                },
            },
        },
        async (request, reply) => {
            try {
                const { id } = request.params as { id: string };
                const project = await adminService.getProjectDetails(id);
                return reply.send(project);
            } catch (error: any) {
                console.error('Error fetching project details:', error);
                if (error.message === 'Project not found') {
                    return reply.status(404).send({ error: error.message });
                }
                return reply.status(500).send({
                    error: 'Failed to fetch project details',
                });
            }
        }
    );

    // DELETE /api/v1/admin/projects/:id - Delete project
    fastify.delete(
        '/projects/:id',
        {
            preHandler: [authenticate, requireAdmin],
            config: {
                rateLimit: {
                    max: 100,
                    timeWindow: '1 minute',
                },
            },
        },
        async (request, reply) => {
            try {
                const { id } = request.params as { id: string };
                const project = await adminService.getProjectDetails(id);
                const result = await adminService.deleteProject(id);

                auditLogService.log({
                    organizationId: project.organization_id,
                    userId: (request as any).user?.id,
                    userEmail: (request as any).user?.email,
                    action: 'admin_delete_project',
                    category: 'data_modification',
                    resourceType: 'project',
                    resourceId: id,
                    ipAddress: request.ip,
                    userAgent: request.headers['user-agent'],
                });

                return reply.send(result);
            } catch (error: any) {
                console.error('Error deleting project:', error);
                if (error.message === 'Project not found') {
                    return reply.status(404).send({ error: error.message });
                }
                return reply.status(500).send({
                    error: 'Failed to delete project',
                });
            }
        }
    );

    // GET /api/v1/admin/stats/platform-timeline - Platform activity timeline
    fastify.get(
        '/stats/platform-timeline',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (request, reply) => {
            try {
                const { hours: hoursParam = '24' } = request.query as { hours?: string };
                const hours = parseInt(hoursParam);
                if (isNaN(hours) || hours < 1 || hours > 168) {
                    return reply.status(400).send({ error: 'Invalid hours parameter (1-168)' });
                }
                const stats = await adminService.getPlatformTimeline(hours);
                return reply.send(stats);
            } catch (error) {
                console.error('Error getting platform timeline:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve platform timeline',
                });
            }
        }
    );

    // GET /api/v1/admin/stats/active-issues - Active issues summary
    fastify.get(
        '/stats/active-issues',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const stats = await adminService.getActiveIssues();
                return reply.send(stats);
            } catch (error) {
                console.error('Error getting active issues:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve active issues',
                });
            }
        }
    );

    // GET /api/v1/admin/stats/compression - Compression statistics for all hypertables
    fastify.get(
        '/stats/compression',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const stats = await adminService.getCompressionStats();
                return reply.send({ hypertables: stats });
            } catch (error) {
                console.error('Error getting compression stats:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve compression statistics',
                });
            }
        }
    );

    // GET /api/v1/admin/stats/continuous-aggregates - Continuous aggregate health
    fastify.get(
        '/stats/continuous-aggregates',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const stats = await adminService.getAggregateStats();
                return reply.send({ aggregates: stats });
            } catch (error) {
                console.error('Error getting aggregate stats:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve continuous aggregate statistics',
                });
            }
        }
    );

    // GET /api/v1/admin/stats/slow-queries - Slow/active queries
    fastify.get(
        '/stats/slow-queries',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const stats = await adminService.getSlowQueries();
                return reply.send(stats);
            } catch (error) {
                console.error('Error getting slow queries:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve slow queries',
                });
            }
        }
    );

    // GET /api/v1/admin/version-check - Check for new releases on GitHub
    fastify.get(
        '/version-check',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const result = await adminService.checkVersion();
                return reply.send(result);
            } catch (error) {
                console.error('Error checking version:', error);
                return reply.status(500).send({
                    error: 'Failed to check for updates',
                });
            }
        }
    );

    // Cache Management Routes
    // GET /api/v1/admin/cache/stats - Get cache statistics
    fastify.get(
        '/cache/stats',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const stats = await adminService.getCacheStats();
                return reply.send(stats);
            } catch (error) {
                console.error('Error getting cache stats:', error);
                return reply.status(500).send({
                    error: 'Failed to retrieve cache statistics',
                });
            }
        }
    );

    // POST /api/v1/admin/cache/clear - Clear all caches
    fastify.post(
        '/cache/clear',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (_request, reply) => {
            try {
                const result = await adminService.clearCache();
                return reply.send({
                    message: 'Cache cleared successfully',
                    ...result,
                });
            } catch (error) {
                console.error('Error clearing cache:', error);
                return reply.status(500).send({
                    error: 'Failed to clear cache',
                });
            }
        }
    );

    // POST /api/v1/admin/cache/invalidate/:projectId - Invalidate project cache
    fastify.post(
        '/cache/invalidate/:projectId',
        {
            config: {
                rateLimit: rateLimitConfig,
            },
        },
        async (request, reply) => {
            try {
                const { projectId } = request.params as { projectId: string };
                await adminService.invalidateProjectCache(projectId);
                return reply.send({
                    message: `Cache invalidated for project ${projectId}`,
                });
            } catch (error) {
                console.error('Error invalidating project cache:', error);
                return reply.status(500).send({
                    error: 'Failed to invalidate project cache',
                });
            }
        }
    );
}
