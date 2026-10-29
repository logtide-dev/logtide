import type { RequestHandler } from '@sveltejs/kit';
import { legacyRedirect } from '$lib/utils/legacy-routes';

// Monitor detail moved from /dashboard/monitoring/[id] to /dashboard/uptime/[id].
export const GET: RequestHandler = ({ url, params }) =>
  legacyRedirect(url, `/dashboard/uptime/${encodeURIComponent(params.id)}`);
