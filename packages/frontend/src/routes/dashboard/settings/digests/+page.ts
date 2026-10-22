import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Moved under Settings > Notifications. Keeps the query string. Never read url.hash here: SvelteKit's tracked URL throws on it in dev.
export const load: PageLoad = ({ url }) => {
	redirect(308, '/dashboard/settings/notifications/digests' + url.search);
};
