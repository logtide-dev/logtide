// Incidents module barrel. Worker code (alert evaluation, monitor checks)
// imports `./service.js` directly, which pulls in no Fastify or queue module.
export { incidentsService, IncidentsService } from './service.js';
export type { IncidentPatch } from './service.js';
export * from './types.js';
export { planStatusChange, higherSeverity } from './status.js';
