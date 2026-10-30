import type { LogtideExtension } from '../../../extensions/types.js';

/**
 * HTTP surface fixture: a session route, an org-role route, a public route
 * with a raw-buffer JSON parser (webhook style) and a public config entry.
 */
const httpFixture: LogtideExtension = {
  name: 'fixture',
  apiVersion: 1,
  register(api) {
    api.publicConfig(() => ({ enabled: true }));

    api.routes(async (app) => {
      app.get('/me', { preHandler: api.auth.requireSession }, async (request) => ({
        userId: request.user?.id,
      }));

      app.get<{ Params: { orgId: string } }>(
        '/orgs/:orgId/role',
        { preHandler: api.auth.requireOrgRole(['owner', 'admin']) },
        async (request) => ({ role: request.extOrg?.role, orgId: request.extOrg?.id })
      );

      app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
        done(null, body);
      });

      app.post('/hook', async (request) => ({
        isBuffer: Buffer.isBuffer(request.body),
        raw: Buffer.isBuffer(request.body) ? request.body.toString('utf8') : null,
      }));
    });
  },
};

export default httpFixture;
