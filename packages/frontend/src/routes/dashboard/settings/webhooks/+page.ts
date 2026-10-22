import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Moved under Settings > Notifications. Keeps the query string and hash.
export const load: PageLoad = ({ url }) => {
	redirect(308, '/dashboard/settings/notifications/delivery-log' + url.search + url.hash);
};
