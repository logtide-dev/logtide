import type { RequestHandler } from '@sveltejs/kit';
import { legacyRedirect } from '$lib/utils/legacy-routes';

// Uptime moved from /dashboard/monitoring to /dashboard/uptime.
export const GET: RequestHandler = ({ url }) => legacyRedirect(url, '/dashboard/uptime');
