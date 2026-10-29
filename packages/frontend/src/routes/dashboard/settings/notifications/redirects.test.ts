import { describe, it, expect } from 'vitest';
import { load as channelsLoad } from '../channels/+page';
import { load as webhooksLoad } from '../webhooks/+page';
import { load as digestsLoad } from '../digests/+page';
import { load as notificationsLoad } from './+page';

type Loader = (event: { url: URL }) => unknown;

function redirectOf(loader: unknown, href: string): { status: number; location: string } {
	// SvelteKit hands `load` a tracked URL whose hash getter throws in dev (UI-6).
	const url = new URL(href);
	Object.defineProperty(url, 'hash', {
		get() {
			throw new Error('Cannot access event.url.hash');
		}
	});
	try {
		(loader as Loader)({ url });
	} catch (thrown) {
		return thrown as { status: number; location: string };
	}
	throw new Error('loader did not redirect');
}

describe('old notification routes', () => {
	it('redirects channels to destinations keeping the query', () => {
		const r = redirectOf(channelsLoad, 'https://x/dashboard/settings/channels?a=1#h');
		expect(r.status).toBe(308);
		expect(r.location).toBe('/dashboard/settings/notifications/destinations?a=1');
	});

	it('redirects webhooks to the delivery log keeping the query', () => {
		const r = redirectOf(webhooksLoad, 'https://x/dashboard/settings/webhooks?x=1');
		expect(r.status).toBe(308);
		expect(r.location).toBe('/dashboard/settings/notifications/delivery-log?x=1');
	});

	it('redirects digests to the moved digests page', () => {
		const r = redirectOf(digestsLoad, 'https://x/dashboard/settings/digests?tab=sections');
		expect(r.status).toBe(308);
		expect(r.location).toBe('/dashboard/settings/notifications/digests?tab=sections');
	});

	it('redirects the notifications root to destinations', () => {
		const r = redirectOf(notificationsLoad, 'https://x/dashboard/settings/notifications');
		expect(r.status).toBe(308);
		expect(r.location).toBe('/dashboard/settings/notifications/destinations');
	});

	it('sends a bare old url to the new url without a trailing question mark', () => {
		const r = redirectOf(channelsLoad, 'https://x/dashboard/settings/channels');
		expect(r.location).toBe('/dashboard/settings/notifications/destinations');
	});
});
