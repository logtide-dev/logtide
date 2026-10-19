import { db } from '../../database/index.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Middleware to verify that the authenticated user is an admin
 * Requires that session authentication has already been performed
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
    // Service principal was already vetted by authenticate on opted-in routes
    if (request.servicePrincipal) {
        return;
    }

    const user = (request as any).user;

    if (!user) {
        return reply.status(401).send({
            error: 'Authentication required',
        });
    }

    // Check if user is admin
    const adminUser = await db
        .selectFrom('users')
        .select('is_admin')
        .where('id', '=', user.id)
        .executeTakeFirst();

    if (!adminUser?.is_admin) {
        return reply.status(403).send({
            error: 'Admin access required',
            message: 'You must be an administrator to access this resource',
        });
    }

    // User is admin, continue
}
