import type { RequestHandler } from '@sveltejs/kit';
import { redirectTo, webVitalsRedirectTarget } from '$lib/utils/legacy-routes';

// Performance moved from /dashboard/projects/<id>/performance to /dashboard/web-vitals.
export const GET: RequestHandler = ({ params, url }) =>
  redirectTo(webVitalsRedirectTarget(params.id ?? '', url.search));
