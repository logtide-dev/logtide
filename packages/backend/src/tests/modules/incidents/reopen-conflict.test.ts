import { describe, it, expect } from 'vitest';
import { incidentsService } from '../../../modules/incidents/service.js';
import { IncidentError } from '../../../modules/incidents/types.js';
import { createTestContext } from '../../helpers/factories.js';
import { createTestMonitor, insertIncident } from './fixtures.js';

describe('reopening an alert or monitor incident', () => {
  it('answers invalid_transition (409) while a newer incident of the monitor is active', async () => {
    const ctx = await createTestContext();
    const orgId = ctx.organization.id;
    const monitor = await createTestMonitor({ organizationId: orgId, projectId: ctx.project.id });
    const old = await insertIncident({ organizationId: orgId, projectId: ctx.project.id, source: 'monitor', monitorId: monitor.id, status: 'resolved' });
    await insertIncident({ organizationId: orgId, projectId: ctx.project.id, source: 'monitor', monitorId: monitor.id, status: 'open' });

    const err = await incidentsService.update(old.id, orgId, { status: 'open' }, ctx.user.id).catch((e) => e);
    expect(err).toBeInstanceOf(IncidentError);
    expect(err.code).toBe('invalid_transition');
    expect(err.statusCode).toBe(409);
  });

  it('still reopens when nothing else is active', async () => {
    const ctx = await createTestContext();
    const orgId = ctx.organization.id;
    const monitor = await createTestMonitor({ organizationId: orgId, projectId: ctx.project.id });
    const old = await insertIncident({ organizationId: orgId, projectId: ctx.project.id, source: 'monitor', monitorId: monitor.id, status: 'resolved' });

    const updated = await incidentsService.update(old.id, orgId, { status: 'open' }, ctx.user.id);
    expect(updated?.status).toBe('open');
  });
});
