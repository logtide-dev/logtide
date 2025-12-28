import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notificationsService } from './service.js';
import { authenticate } from '../auth/middleware.js';

const notificationIdSchema = z.object({
  id: z.string().uuid('Invalid notification ID format'),
});

const getNotificationsQuerySchema = z.object({
  unreadOnly: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 50)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
});

export async function notificationsRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // Get all notifications for current user
  fastify.get('/', async (request: any, reply) => {
    try {
      const query = getNotificationsQuerySchema.parse(request.query);

      const result = await notificationsService.getUserNotifications(request.user.id, {
        unreadOnly: query.unreadOnly,
        limit: query.limit,
        offset: query.offset,
      });

      return reply.send(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      throw error;
    }
  });

  // Mark notification as read
  fastify.put('/:id/read', async (request: any, reply) => {
    try {
      const { id } = notificationIdSchema.parse(request.params);

      await notificationsService.markAsRead(id, request.user.id);

      return reply.send({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid notification ID format',
        });
      }

      throw error;
    }
  });

  // Mark all notifications as read
  fastify.put('/read-all', async (request: any, reply) => {
    await notificationsService.markAllAsRead(request.user.id);

    return reply.send({ success: true });
  });

  // Delete all notifications
  fastify.delete('/all', async (request: any, reply) => {
    await notificationsService.deleteAllNotifications(request.user.id);

    return reply.status(204).send();
  });

  // Delete a notification
  fastify.delete('/:id', async (request: any, reply) => {
    try {
      const { id } = notificationIdSchema.parse(request.params);

      await notificationsService.deleteNotification(id, request.user.id);

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid notification ID format',
        });
      }

      throw error;
    }
  });
}
