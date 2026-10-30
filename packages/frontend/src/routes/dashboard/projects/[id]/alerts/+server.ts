import type { RequestHandler } from '@sveltejs/kit';
import { projectAlertsRedirectTarget, redirectTo } from '$lib/utils/legacy-routes';

// The project Alerts tab moved to the global Alerts page, scoped to the project.
export const GET: RequestHandler = ({ params, url }) =>
  redirectTo(projectAlertsRedirectTarget(params.id ?? '', url.search));
