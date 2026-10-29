import type { RequestHandler } from '@sveltejs/kit';
import { redirectTo, sessionsRedirectTarget } from '$lib/utils/legacy-routes';

// Sessions moved from /dashboard/projects/<id>/sessions to /dashboard/sessions.
export const GET: RequestHandler = ({ params, url }) =>
  redirectTo(sessionsRedirectTarget(params.id ?? '', url.search));
