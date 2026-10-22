/**
 * Permanent redirect for a moved route. `targetPath` must be a fixed constant
 * (plus encoded params) owned by the caller, never user input, so the location
 * can only ever be a same-origin path. The query string is kept verbatim.
 */
export function legacyRedirect(url: URL, targetPath: string): Response {
  return new Response(null, {
    status: 308,
    headers: { location: targetPath + url.search },
  });
}

/**
 * Keep every incoming query param except the project ones: the id in the old
 * path is the source of truth and becomes the canonical `project` param.
 */
function withProject(base: string, projectId: string, search: string): string {
  const incoming = new URLSearchParams(search);
  incoming.delete('project');
  incoming.delete('projectId');
  const params = new URLSearchParams({ project: projectId });
  for (const [key, value] of incoming) params.append(key, value);
  return `${base}?${params.toString()}`;
}

/** /dashboard/projects/<id>/sessions -> /dashboard/sessions?project=<id> */
export function sessionsRedirectTarget(projectId: string, search: string): string {
  return withProject('/dashboard/sessions', projectId, search);
}

/** /dashboard/projects/<id>/sessions/<sid> -> /dashboard/sessions/<sid>?project=<id> */
export function sessionDetailRedirectTarget(projectId: string, sessionId: string, search: string): string {
  return withProject(`/dashboard/sessions/${encodeURIComponent(sessionId)}`, projectId, search);
}

/** /dashboard/projects/<id>/performance -> /dashboard/web-vitals?project=<id> */
export function webVitalsRedirectTarget(projectId: string, search: string): string {
  return withProject('/dashboard/web-vitals', projectId, search);
}

/** 308 to a target built by one of the builders above (same-origin path only). */
export function redirectTo(target: string): Response {
  return new Response(null, { status: 308, headers: { location: target } });
}
