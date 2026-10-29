import { z } from 'zod';
import { PACK_CATEGORIES, SIGMA_LEVELS } from '@logtide/shared';

/**
 * Query arrays arrive as repeated keys (`severity=a&severity=b`) or as comma
 * separated lists (`severity=a,b`); both normalise to a string array.
 */
function listParam<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === '') return undefined;
    const parts = Array.isArray(value) ? value : [value];
    const flat = parts
      .flatMap((p) => String(p).split(','))
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    return flat.length > 0 ? flat : undefined;
  }, z.array(item).optional());
}

const boolParam = z.preprocess((value) => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value === undefined || value === '' ? undefined : value;
}, z.boolean().optional());

export const ruleListQuerySchema = z.object({
  organizationId: z.string().uuid(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().max(200).optional(),
  severity: listParam(z.enum(SIGMA_LEVELS)),
  tactic: listParam(z.string().max(64)),
  source: listParam(z.enum(['custom', 'sigmahq', 'pack'])),
  category: listParam(z.enum(PACK_CATEGORIES)),
  enabled: boolParam,
  projectId: z.string().uuid().optional(),
  sortBy: z.enum(['title', 'level', 'hits7d', 'lastFiredAt', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
