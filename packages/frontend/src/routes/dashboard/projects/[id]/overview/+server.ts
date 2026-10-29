import type { RequestHandler } from '@sveltejs/kit';
import { legacyRedirect } from '$lib/utils/legacy-routes';

// The Overview tab is gone: the project page itself is the health view now.
export const GET: RequestHandler = ({ params, url }) =>
  legacyRedirect(url, `/dashboard/projects/${encodeURIComponent(params.id ?? '')}`);
