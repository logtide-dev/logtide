import type { RequestHandler } from '@sveltejs/kit';
import { redirectTo } from '$lib/utils/legacy-routes';

// Hardware moved into Metrics (1.8): the hosts list is the Hosts kind of Sources.
export const GET: RequestHandler = ({ url }) => {
  const params = new URLSearchParams(url.search);
  params.set('kind', 'host');
  return redirectTo(`/dashboard/metrics?${params.toString()}`);
};
