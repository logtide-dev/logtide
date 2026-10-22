import type { RequestHandler } from '@sveltejs/kit';
import { legacyRedirect } from '$lib/utils/legacy-routes';

// Incident detail moved from /dashboard/security/incidents/[id] to /dashboard/incidents/[id].
export const GET: RequestHandler = ({ url, params }) =>
  legacyRedirect(url, `/dashboard/incidents/${encodeURIComponent(params.id)}`);
