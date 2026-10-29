import { tracesAPI } from '$lib/api/traces';

const MAX_CANDIDATES = 20;

/**
 * Finds the project that owns a trace when the link carries no project.
 * Tries the candidates in order (at most 20), treats a rejected or 404 lookup
 * as "not here" and returns the first hit, or null.
 */
export async function resolveTraceProject(
  traceId: string,
  candidateProjectIds: string[],
  fetchTrace: (traceId: string, projectId: string) => Promise<unknown> = (id, pid) =>
    tracesAPI.getTrace(id, pid)
): Promise<string | null> {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const id of candidateProjectIds) {
    if (id && !seen.has(id)) {
      seen.add(id);
      candidates.push(id);
    }
  }

  for (const projectId of candidates.slice(0, MAX_CANDIDATES)) {
    try {
      const trace = await fetchTrace(traceId, projectId);
      if (trace) return projectId;
    } catch {
      // Not in this project (404) or the lookup failed: keep scanning.
    }
  }
  return null;
}
