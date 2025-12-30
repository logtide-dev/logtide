import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config/index.js';
import { connection } from './queue/connection.js';
import authPlugin from './modules/auth/plugin.js';
import { ingestionRoutes } from './modules/ingestion/index.js';
import { queryRoutes } from './modules/query/index.js';
import { alertsRoutes } from './modules/alerts/index.js';
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
import { settingsRoutes, publicSettingsRoutes, settingsService } from './modules/settings/index.js';
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
    bodyLimit: 10 * 1024 * 1024, // 10MB for large OTLP batches
    // Trust proxy headers when behind reverse proxy (Traefik, nginx, etc.)
    // This ensures rate limiting uses real client IP, not proxy IP
    trustProxy: config.TRUST_PROXY,
    ...opts,
  });

  // CORS configuration
  // Allow all origins to support browser-based SDK usage
  // Security is provided by API key authentication for ingestion routes
  // and session authentication for dashboard/UI routes
  await fastify.register(cors, {
    origin: true, // Allow all origins (API key + session auth provide security)
    credentials: true, // Allow cookies/credentials for SSE
  });

  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      }
    },
    crossOriginEmbedderPolicy: false, // Allow embedding for SSE
  });

  // Rate limiting with Redis store for horizontal scaling
  // Using Redis ensures rate limits are shared across all backend instances
  await fastify.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    redis: connection,
    // Use real client IP when behind proxy (requires trustProxy: true)
    keyGenerator: (request) => {
      return request.ip;
    },
  });

  // Internal logging plugin (logs all requests except ingestion endpoints)
  await fastify.register(internalLoggingPlugin);

  // Health check (no auth required)
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.3.3',
    };
  });

  // User authentication routes (no API key required)
  await fastify.register(usersRoutes, { prefix: '/api/v1/auth' });

  // External authentication routes (OIDC, LDAP)
  await fastify.register(publicAuthRoutes, { prefix: '/api/v1/auth' });
  await fastify.register(publicSettingsRoutes, { prefix: '/api/v1/auth' }); // Public auth config endpoint
  await fastify.register(authenticatedAuthRoutes, { prefix: '/api/v1/auth' });
  await fastify.register(adminAuthRoutes, { prefix: '/api/v1/admin/auth' });

  // Organizations routes (session-based auth)
  await fastify.register(organizationsRoutes, { prefix: '/api/v1/organizations' });

  // Invitations routes (session-based auth, some public endpoints)
  await fastify.register(invitationsRoutes, { prefix: '/api/v1/invitations' });

  // Projects routes (session-based auth)
  await fastify.register(projectsRoutes, { prefix: '/api/v1/projects' });

  // Notifications routes (session-based auth)
  await fastify.register(notificationsRoutes, { prefix: '/api/v1/notifications' });

  // Onboarding routes (session-based auth)
  await fastify.register(onboardingRoutes, { prefix: '/api/v1/onboarding' });

  // Alerts routes (session-based auth)
  await fastify.register(alertsRoutes, { prefix: '/api/v1/alerts' });

  // Sigma rules routes (session-based auth)
  await fastify.register(sigmaRoutes);

  // SIEM routes (session-based auth)
  await fastify.register(siemRoutes);

  // SIEM SSE routes for real-time updates (session-based auth)
  await fastify.register(registerSiemSseRoutes);

  // API keys management routes (session-based auth)
  await fastify.register(apiKeysRoutes, { prefix: '/api/v1/projects' });

  // Dashboard routes (session-based auth)
  await fastify.register(dashboardRoutes);

  // Admin routes (session-based auth + admin middleware)
  await fastify.register(adminRoutes, { prefix: '/api/v1/admin' });

  // Admin settings routes (session-based auth + admin middleware)
  await fastify.register(settingsRoutes, { prefix: '/api/v1/admin/settings' });

  // Register API key auth plugin (applies to log ingestion/query routes below)
  await fastify.register(authPlugin);

  // Register log management routes (require API key)
  await fastify.register(ingestionRoutes);
  await fastify.register(queryRoutes);

  // Register OTLP routes (OpenTelemetry Protocol - require API key)
  await fastify.register(otlpRoutes);
  await fastify.register(otlpTraceRoutes);

  // Register traces API routes (require API key or session auth)
  await fastify.register(tracesRoutes);

  // Register WebSocket support
  await fastify.register(websocketPlugin);
  await fastify.register(websocketRoutes);

  return fastify;
}

async function start() {

  // Run initial bootstrap first (creates initial admin from env vars if no users exist)
  // This must run before internal logging so the admin can be owner of internal org
  await bootstrapService.runInitialBootstrap();

  // Initialize internal logging (uses existing admin or creates system user)
  await initializeInternalLogging();

  // Initialize enrichment services (GeoLite2 database, etc.)
  await enrichmentService.initialize();

  // Check auth mode and bootstrap if auth-free mode is enabled
  const authMode = await settingsService.getAuthMode();
  if (authMode === 'none') {
    console.log('[Auth] Auth-free mode detected, ensuring default setup...');
    await bootstrapService.ensureDefaultSetup();
  }

  const app = await build();

  // Graceful shutdown handlers
  const shutdown = async () => {
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
