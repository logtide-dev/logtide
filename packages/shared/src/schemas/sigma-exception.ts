import { z } from 'zod';

const FIELD_REGEX = /^[A-Za-z_][A-Za-z0-9_.\-]{0,127}$/;

export const exceptionOperatorSchema = z.enum(['equals', 'contains', 'in']);

export const exceptionConditionSchema = z
  .object({
    field: z.string().regex(FIELD_REGEX, 'Invalid field name'),
    operator: exceptionOperatorSchema,
    values: z.array(z.string().min(1).max(500)).min(1).max(50),
  })
  .superRefine((cond, ctx) => {
    if (cond.operator !== 'in' && cond.values.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['values'],
        message: `Operator "${cond.operator}" takes exactly one value`,
      });
    }
  });

export const createExceptionSchema = z.object({
  conditions: z.array(exceptionConditionSchema).min(1).max(5),
  reason: z.string().max(500).optional(),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .refine((v) => new Date(v).getTime() > Date.now(), {
      message: 'Expiry must be in the future',
    })
    .optional(),
});

export type ExceptionConditionInput = z.infer<typeof exceptionConditionSchema>;
export type CreateExceptionInput = z.infer<typeof createExceptionSchema>;
