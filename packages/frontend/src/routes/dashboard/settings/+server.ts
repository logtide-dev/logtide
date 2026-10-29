import type { RequestHandler } from '@sveltejs/kit';
import { legacyRedirect } from '$lib/utils/legacy-routes';

// The settings index has no content of its own.
export const GET: RequestHandler = ({ url }) => legacyRedirect(url, '/dashboard/settings/general');
