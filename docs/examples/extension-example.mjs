// Minimal LogTide extension: one authenticated route, one migration folder
// and one cron job. Load it with LOGTIDE_EXTENSIONS=/path/to/extension-example.mjs
//
// Extensions are plain ES modules. They must not import anything from the
// backend source tree: everything they need arrives through the `api` object.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  // Becomes the Postgres schema name and the route prefix.
  name: 'example',
  apiVersion: 1,

  register(api) {
    // SQL files in this folder are applied to the "example" schema at boot.
    api.migrate(path.join(here, 'extension-example-migrations'));

    // Mounted at /api/v1/ext/example. Extension routes skip the global auth
    // plugin, so every route picks its own auth.
    api.routes(async (fastify) => {
      fastify.get(
        '/orgs/:orgId/hello',
        { preHandler: api.auth.requireOrgRole(['owner', 'admin']) },
        async (request) => {
          const org = await api.orgs.get(request.extOrg.id);
          return { hello: org?.name ?? null, role: request.extOrg.role };
        }
      );
    });

    // Handler for the "tick" job. It runs in the worker process.
    api.queue.registerJob('tick', async () => {
      api.logger.info('tick');
    });

    // Run it every hour (queue name: ext:example:tick).
    api.queue.schedule('tick', '0 * * * *');
  },
};
