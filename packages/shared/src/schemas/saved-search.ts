import { z } from 'zod';
import { TIME_RANGE_PRESETS } from '../types/time-range.js';

// Saved log searches: the explorer state a user can name and reopen.
// Shared by the backend (validation, persistence) and the frontend (dialogs).

export const SAVED_SEARCH_VISIBILITIES = ['private', 'organization'] as const;
export type SavedSearchVisibility = (typeof SAVED_SEARCH_VISIBILITIES)[number];

export const SAVED_SEARCH_Q_MAX_LENGTH = 2000;
export const SAVED_SEARCH_NAME_MAX_LENGTH = 200;
export const SAVED_SEARCH_MAX_PROJECTS = 100;
export const SAVED_SEARCH_MAX_COLUMNS = 20;

export const savedSearchVisibilitySchema = z.enum(SAVED_SEARCH_VISIBILITIES);

export const savedSearchStateSchema = z
  .object({
    q: z.string().max(SAVED_SEARCH_Q_MAX_LENGTH),
    projectIds: z.array(z.string().uuid()).max(SAVED_SEARCH_MAX_PROJECTS),
    range: z.enum(TIME_RANGE_PRESETS).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    view: z.enum(['table', 'terminal']).optional(),
    columns: z.array(z.string().min(1).max(200)).max(SAVED_SEARCH_MAX_COLUMNS).optional(),
  })
  .strict()
  .superRefine((state, ctx) => {
    const hasFrom = state.from !== undefined;
    const hasTo = state.to !== undefined;
    if (state.range !== undefined && (hasFrom || hasTo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['range'],
        message: 'Use either range or from and to, not both',
      });
    }
    if (hasFrom !== hasTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasFrom ? 'to' : 'from'],
        message: 'from and to must be set together',
      });
    }
    if (hasFrom && hasTo && new Date(state.from as string).getTime() >= new Date(state.to as string).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: '"to" must be after "from"',
      });
    }
  });

export type SavedSearchState = z.infer<typeof savedSearchStateSchema>;

const savedSearchNameSchema = z.string().trim().min(1).max(SAVED_SEARCH_NAME_MAX_LENGTH);

export const savedSearchCreateSchema = z.object({
  organizationId: z.string().uuid(),
  name: savedSearchNameSchema,
  visibility: savedSearchVisibilitySchema.default('private'),
  state: savedSearchStateSchema,
});

export const savedSearchUpdateSchema = z
  .object({
    name: savedSearchNameSchema.optional(),
    visibility: savedSearchVisibilitySchema.optional(),
    state: savedSearchStateSchema.optional(),
  })
  .refine((patch) => patch.name !== undefined || patch.visibility !== undefined || patch.state !== undefined, {
    message: 'Provide at least one of name, visibility or state',
  });

export type SavedSearchCreateInput = z.infer<typeof savedSearchCreateSchema>;
export type SavedSearchUpdateInput = z.infer<typeof savedSearchUpdateSchema>;

export interface SavedSearch {
  id: string;
  organizationId: string;
  /** null once the creator is deleted */
  createdBy: string | null;
  /** null once the creator is deleted */
  createdByName: string | null;
  name: string;
  visibility: SavedSearchVisibility;
  state: SavedSearchState;
  canEdit: boolean;
  /** ISO 8601 UTC */
  createdAt: string;
  /** ISO 8601 UTC */
  updatedAt: string;
}
