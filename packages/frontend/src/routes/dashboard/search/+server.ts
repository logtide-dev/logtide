import type { RequestHandler } from '@sveltejs/kit';
import { legacyRedirect } from '$lib/utils/legacy-routes';

// Logs moved from /dashboard/search to /dashboard/logs.
export const GET: RequestHandler = ({ url }) => legacyRedirect(url, '/dashboard/logs');
