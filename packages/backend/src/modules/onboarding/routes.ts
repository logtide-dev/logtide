import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { onboardingService } from './service.js';
import { authenticate } from '../auth/middleware.js';

const updateOnboardingSchema = z.object({
  checklistItems: z.record(z.boolean()).optional(),
  checklistCollapsed: z.boolean().optional(),
  checklistDismissed: z.boolean().optional(),
  tutorialCompleted: z.boolean().optional(),
  tutorialStep: z.number().int().min(0).optional(),
  tutorialSkipped: z.boolean().optional(),
});

const completeItemSchema = z.object({
  itemId: z.string().min(1),
});

export async function onboardingRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // Get current onboarding state
  fastify.get('/', async (request: any, reply) => {
    const state = await onboardingService.getOnboardingState(request.user.id);
    return reply.send(state);
  });

  // Update onboarding state
  fastify.put('/', async (request: any, reply) => {
    try {
      const updates = updateOnboardingSchema.parse(request.body);
      const state = await onboardingService.updateOnboardingState(request.user.id, updates);
      return reply.send(state);
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

  // Complete a checklist item
  fastify.post('/checklist/complete', async (request: any, reply) => {
    try {
      const { itemId } = completeItemSchema.parse(request.body);
      const state = await onboardingService.completeChecklistItem(request.user.id, itemId);
      return reply.send(state);
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

  // Reset onboarding state (restart tutorial)
  fastify.post('/reset', async (request: any, reply) => {
    const state = await onboardingService.resetOnboardingState(request.user.id);
    return reply.send(state);
  });
}
