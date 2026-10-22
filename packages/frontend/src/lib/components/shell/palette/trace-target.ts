export interface TraceTargetContext {
  scopeProjectIds: string[];
  tracesProjectIds: string[];
  allProjectIds: string[];
}

/**
 * The trace detail page needs a project. Pick the most likely one without
 * guessing between several: the single scoped project, else the only project
 * with traces, else the only project overall, else none.
 */
export function resolveTraceTarget(
  _traceId: string,
  ctx: TraceTargetContext
): { projectId: string | null } {
  if (ctx.scopeProjectIds.length === 1) return { projectId: ctx.scopeProjectIds[0] };
  if (ctx.tracesProjectIds.length === 1) return { projectId: ctx.tracesProjectIds[0] };
  if (ctx.allProjectIds.length === 1) return { projectId: ctx.allProjectIds[0] };
  return { projectId: null };
}
