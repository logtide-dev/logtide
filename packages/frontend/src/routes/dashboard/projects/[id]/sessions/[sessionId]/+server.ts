import type { RequestHandler } from '@sveltejs/kit';
import { redirectTo, sessionDetailRedirectTarget } from '$lib/utils/legacy-routes';

// Session detail moved to /dashboard/sessions/<sessionId>?project=<id>.
export const GET: RequestHandler = ({ params, url }) =>
  redirectTo(sessionDetailRedirectTarget(params.id ?? '', params.sessionId ?? '', url.search));
