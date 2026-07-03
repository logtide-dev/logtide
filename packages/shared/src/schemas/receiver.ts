import { z } from 'zod';
import { LOG_LEVELS, RECEIVER_ADAPTER_TYPES } from '../constants/index.js';

export const receiverAdapterTypeSchema = z.enum(RECEIVER_ADAPTER_TYPES);

const dotPath = z.string().min(1).max(200);

/**
 * Field mapping for the 'generic' receiver adapter (#155).
 * Values are dot-paths into the raw payload (e.g. "error.message").
 */
export const receiverFieldMappingSchema = z
  .object({
    message: dotPath.optional(),
    level: dotPath.optional(),
    service: dotPath.optional(),
    timestamp: dotPath.optional(),
    levelMap: z.record(z.enum(LOG_LEVELS)).optional(),
    defaults: z
      .object({
        level: z.enum(LOG_LEVELS).optional(),
        service: z.string().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ReceiverFieldMapping = z.infer<typeof receiverFieldMappingSchema>;
