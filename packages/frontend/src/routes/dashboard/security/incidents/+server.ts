import type { RequestHandler } from '@sveltejs/kit';
import { legacyRedirect } from '$lib/utils/legacy-routes';

// Security incidents moved into the shared inbox at /dashboard/incidents. Old
// links were about detections, so a missing source filter becomes source=sigma.
export const GET: RequestHandler = ({ url }) => {
  const target = new URL(url.href);
  if (!target.searchParams.has('source')) target.searchParams.set('source', 'sigma');
  return legacyRedirect(target, '/dashboard/incidents');
};
