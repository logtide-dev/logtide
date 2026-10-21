import type { RequestHandler } from '@sveltejs/kit';
import { legacyRedirect } from '$lib/utils/legacy-routes';

// Account moved under the settings shell.
export const GET: RequestHandler = ({ url }) =>
  legacyRedirect(url, '/dashboard/settings/account/profile');
