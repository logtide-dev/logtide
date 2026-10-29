import { z } from 'zod';

/**
 * Query values that accept repeated keys (`?a=x&a=y`) and comma lists
 * (`?a=x,y`) alike; an empty list means no filter. Shared by the incidents
 * routes and the SIEM live stream (kept free of Fastify and database imports).
 */
export function listParam<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (v) =>
      v === undefined
        ? undefined
        : (Array.isArray(v) ? v : [v])
            .flatMap((s) => String(s).split(','))
            .map((s) => s.trim())
            .filter(Boolean),
    z.array(schema).optional()
  );
}
