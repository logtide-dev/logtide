// Incidents module barrel. Worker code (alert evaluation, monitor checks)
// imports `./service.js` directly, which pulls in no Fastify or queue module;
// this barrel also exports the routes, which do.
export { incidentsService, IncidentsService } from './service.js';
export type { IncidentPatch } from './service.js';
export * from './types.js';
export { planStatusChange, higherSeverity } from './status.js';
export { incidentsRoutes, registerIncidentRoutes, listParam } from './routes.js';
export type { IncidentRouteOptions } from './routes.js';
