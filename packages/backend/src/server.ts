import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config, isRedisConfigured } from './config/index.js';
import { connection } from './queue/connection.js';
import { notificationManager } from './modules/streaming/index.js';
import authPlugin from './modules/auth/plugin.js';
import { ingestionRoutes } from './modules/ingestion/index.js';
import { queryRoutes } from './modules/query/index.js';
import { alertsRoutes } from './modules/alerts/index.js';
import { detectionPacksRoutes } from './modules/detection-packs/index.js';
import { usersRoutes } from './modules/users/routes.js';
import { projectsRoutes } from './modules/projects/routes.js';
import { organizationsRoutes } from './modules/organizations/routes.js';
import { invitationsRoutes } from './modules/invitations/routes.js';
import { notificationsRoutes } from './modules/notifications/routes.js';
import { apiKeysRoutes } from './modules/api-keys/routes.js';
import dashboardRoutes from './modules/dashboard/routes.js';
import { sigmaRoutes } from './modules/sigma/routes.js';
import { siemRoutes } from './modules/siem/routes.js';
import { registerSiemSseRoutes } from './modules/siem/sse-events.js';
import { adminRoutes } from './modules/admin/index.js';
import { publicAuthRoutes, authenticatedAuthRoutes, adminAuthRoutes } from './modules/auth/external-routes.js';
import { otlpRoutes, otlpTraceRoutes } from './modules/otlp/index.js';
import { tracesRoutes } from './modules/traces/index.js';
import { onboardingRoutes } from './modules/onboarding/index.js';
import { exceptionsRoutes } from './modules/exceptions/index.js';
import { settingsRoutes, publicSettingsRoutes, settingsService } from './modules/settings/index.js';
import { retentionRoutes } from './modules/retention/index.js';
import { correlationRoutes, patternRoutes } from './modules/correlation/index.js';
import { bootstrapService } from './modules/bootstrap/index.js';
import internalLoggingPlugin from './plugins/internal-logging-plugin.js';
import { initializeInternalLogging, shutdownInternalLogging } from './utils/internal-logger.js';
import websocketPlugin from './plugins/websocket.js';
import websocketRoutes from './modules/query/websocket.js';
import { enrichmentService } from './modules/siem/enrichment-service.js';

const PORT = config.PORT;
const HOST = config.HOST;

export async function build(opts = {}) {
  const fastify = Fastify({
    logger: true,
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: config.TRUST_PROXY,
    ...opts,
  });

  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      }
    },
    crossOriginEmbedderPolicy: false,
  });

  if (isRedisConfigured() && connection) {
    await fastify.register(rateLimit, {
      max: config.RATE_LIMIT_MAX,
      timeWindow: config.RATE_LIMIT_WINDOW,
      keyGenerator: (request) => request.ip,
      redis: connection,
    });
    console.log('[RateLimit] Using Redis store (distributed rate limiting)');
  } else {
    await fastify.register(rateLimit, {
      max: config.RATE_LIMIT_MAX,
      timeWindow: config.RATE_LIMIT_WINDOW,
      keyGenerator: (request) => request.ip,
    });
    console.log('[RateLimit] Using in-memory store (single instance only)');
  }

  await fastify.register(internalLoggingPlugin);

  fastify.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.5.0',
    };
  });

  await fastify.register(usersRoutes, { prefix: '/api/v1/auth' });
  await fastify.register(publicAuthRoutes, { prefix: '/api/v1/auth' });
  await fastify.register(publicSettingsRoutes, { prefix: '/api/v1/auth' });
  await fastify.register(authenticatedAuthRoutes, { prefix: '/api/v1/auth' });
  await fastify.register(adminAuthRoutes, { prefix: '/api/v1/admin/auth' });
  await fastify.register(organizationsRoutes, { prefix: '/api/v1/organizations' });
  await fastify.register(invitationsRoutes, { prefix: '/api/v1/invitations' });
  await fastify.register(projectsRoutes, { prefix: '/api/v1/projects' });
  await fastify.register(notificationsRoutes, { prefix: '/api/v1/notifications' });
  await fastify.register(onboardingRoutes, { prefix: '/api/v1/onboarding' });
  await fastify.register(alertsRoutes, { prefix: '/api/v1/alerts' });
  await fastify.register(detectionPacksRoutes, { prefix: '/api/v1/detection-packs' });
  await fastify.register(sigmaRoutes);
  await fastify.register(siemRoutes);
  await fastify.register(registerSiemSseRoutes);
  await fastify.register(exceptionsRoutes);
  await fastify.register(apiKeysRoutes, { prefix: '/api/v1/projects' });
  await fastify.register(dashboardRoutes);
  await fastify.register(adminRoutes, { prefix: '/api/v1/admin' });
  await fastify.register(settingsRoutes, { prefix: '/api/v1/admin/settings' });
  await fastify.register(retentionRoutes, { prefix: '/api/v1/admin' });

  await fastify.register(authPlugin);
  await fastify.register(ingestionRoutes);
  await fastify.register(queryRoutes);
  await fastify.register(correlationRoutes, { prefix: '/api' });
  await fastify.register(patternRoutes, { prefix: '/api' });
  await fastify.register(otlpRoutes);
  await fastify.register(otlpTraceRoutes);
  await fastify.register(tracesRoutes);
  await fastify.register(websocketPlugin);
  await fastify.register(websocketRoutes);

  return fastify;
}

async function start() {
  await bootstrapService.runInitialBootstrap();
  await initializeInternalLogging();
  await enrichmentService.initialize();
  await notificationManager.initialize(config.DATABASE_URL);

  const authMode = await settingsService.getAuthMode();
  if (authMode === 'none') {
    console.log('[Auth] Auth-free mode detected, ensuring default setup...');
    await bootstrapService.ensureDefaultSetup();
  }

  const app = await build();

  const shutdown = async () => {
    console.log('[Server] Shutting down gracefully...');
    await notificationManager.shutdown();
    await shutdownInternalLogging();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());

  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    (app.log as any).error(err as Error);
    await shutdownInternalLogging();
    process.exit(1);
  }
}

// Start the server directly when this file is run
import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start();
}
