import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config, isRedisConfigured } from './config/index.js';
import { getConnection } from './queue/connection.js';
import { notificationManager } from './modules/streaming/index.js';
import authPlugin from './modules/auth/plugin.js';
import { contextPlugin } from './context/index.js';
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
import { receiversRoutes } from './modules/receivers/routes.js';
import { receiversIngestRoutes } from './modules/receivers/ingest-routes.js';
import dashboardRoutes from './modules/dashboard/routes.js';
import { sigmaRoutes } from './modules/sigma/routes.js';
import { siemRoutes } from './modules/siem/routes.js';
import { registerSiemSseRoutes } from './modules/siem/sse-events.js';
import { adminRoutes } from './modules/admin/index.js';
import { publicAuthRoutes, authenticatedAuthRoutes, adminAuthRoutes } from './modules/auth/external-routes.js';
import { otlpRoutes, otlpTraceRoutes, otlpMetricRoutes } from './modules/otlp/index.js';
import { tracesRoutes } from './modules/traces/index.js';
import { metricsRoutes } from './modules/metrics/index.js';
import { onboardingRoutes } from './modules/onboarding/index.js';
import { exceptionsRoutes } from './modules/exceptions/index.js';
import { settingsRoutes, publicSettingsRoutes, settingsService } from './modules/settings/index.js';
import { retentionRoutes } from './modules/retention/index.js';
import { correlationRoutes, patternRoutes } from './modules/correlation/index.js';
import { piiMaskingRoutes } from './modules/pii-masking/index.js';
import { pipelineRoutes } from './modules/log-pipeline/index.js';
import { customDashboardsRoutes } from './modules/custom-dashboards/index.js';
import { usageRoutes, meteringRecorder, meteringService } from './modules/metering/index.js';
import { capabilitiesRoutes, adminEntitlementsRoutes } from './modules/capabilities/index.js';
import { QuotaEvaluator } from './capabilities/index.js';
import { loadExternalHooks } from './hooks/index.js';
import { storageSnapshotJob } from './modules/metering/storage-snapshot.js';
import { monitoringRoutes, heartbeatRoutes, publicStatusRoutes } from './modules/monitoring/index.js';
import { statusIncidentRoutes } from './modules/status-incidents/routes.js';
import { maintenanceRoutes } from './modules/maintenances/routes.js';
import { sessionsRoutes } from './modules/sessions/routes.js';
import { sourcemapsRoutes } from './modules/sourcemaps/index.js';
import { auditLogRoutes, auditLogService } from './modules/audit-log/index.js';
import { bootstrapService } from './modules/bootstrap/index.js';
import { runDataAvailabilityBackfill } from './modules/projects/data-availability-backfill.js';
import { notificationChannelsRoutes } from './modules/notification-channels/index.js';
import { webhookDeliveriesRoutes } from './modules/webhooks/routes.js';
import internalLoggingPlugin from './plugins/internal-logging-plugin.js';
import { initializeInternalLogging, shutdownInternalLogging } from './utils/internal-logger.js';
import websocketPlugin from './plugins/websocket.js';
import websocketRoutes from './modules/query/websocket.js';
import streamTicketRoutes from './modules/streaming/stream-ticket-routes.js';
import { enrichmentService } from './modules/siem/enrichment-service.js';
import { validateStorageConfig } from './database/storage-config.js';
import { shutdownReservoir } from './database/reservoir.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __serverDirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(path.resolve(__serverDirname, '../package.json'), 'utf-8'));

const PORT = config.PORT;
const HOST = config.HOST;

const quotaEvaluator = new QuotaEvaluator(meteringService);

export async function build(opts = {}) {
  const fastify = Fastify({
    logger: true,
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: config.TRUST_PROXY,
    ...opts,
  });

  // Global error handler: ensure client errors return proper 4xx, not 500
  fastify.setErrorHandler((error, request, reply) => {
    const errMessage = error instanceof Error ? error.message : 'Unknown error';

    // Determine HTTP status code:
    // 1. error.statusCode set by Fastify (validation, rate limit) or custom parsers
    // 2. Fastify validation errors have a .validation property → 400
    // 3. ZodError (name === 'ZodError') → 400
    // 4. Default → 500
    let statusCode = typeof (error as any).statusCode === 'number'
      ? (error as any).statusCode
      : undefined;

    if (!statusCode && ((error as any).validation || (error as any).code === 'FST_ERR_VALIDATION')) {
      statusCode = 400;
    }

    if (!statusCode && (error as any).name === 'ZodError') {
      statusCode = 400;
    }

    if (statusCode && statusCode >= 400 && statusCode < 500) {
      const body: Record<string, unknown> = { statusCode, error: errMessage };
      if ((error as any).validation) {
        body.details = (error as any).validation;
      } else if ((error as any).name === 'ZodError' && Array.isArray((error as any).errors)) {
        body.details = (error as any).errors;
      }
      if (typeof (error as any).code === 'string') {
        body.code = (error as any).code;
      }
      reply.code(statusCode).send(body);
      return;
    }

    // Server errors (5xx) or unknown - never expose internal details to clients
    request.log.error(error);
    reply.code(statusCode || 500).send({
      statusCode: statusCode || 500,
      error: 'Internal Server Error',
    });
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

  const rateLimitKeyGenerator = (request: any) => {
    const apiKey = request.headers['x-api-key'] || request.headers['authorization']?.replace('Bearer ', '');
    return apiKey ? `key:${apiKey}` : request.ip;
  };

  const redisConn = getConnection();
  if (isRedisConfigured() && redisConn) {
    await fastify.register(rateLimit, {
      max: config.RATE_LIMIT_MAX,
      timeWindow: config.RATE_LIMIT_WINDOW,
      keyGenerator: rateLimitKeyGenerator,
      redis: redisConn,
    });
    console.log('[RateLimit] Using Redis store (distributed rate limiting)');
  } else {
    await fastify.register(rateLimit, {
      max: config.RATE_LIMIT_MAX,
      timeWindow: config.RATE_LIMIT_WINDOW,
      keyGenerator: rateLimitKeyGenerator,
    });
    console.log('[RateLimit] Using in-memory store (single instance only)');
  }

  await fastify.register(internalLoggingPlugin);

  fastify.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: packageJson.version,
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
  await fastify.register(notificationChannelsRoutes, { prefix: '/api/v1/notification-channels' });
  await fastify.register(webhookDeliveriesRoutes, { prefix: '/api/v1/webhooks' });
  await fastify.register(onboardingRoutes, { prefix: '/api/v1/onboarding' });
  await fastify.register(alertsRoutes, { prefix: '/api/v1/alerts' });
  await fastify.register(detectionPacksRoutes, { prefix: '/api/v1/detection-packs' });
  await fastify.register(sigmaRoutes);
  await fastify.register(siemRoutes);
  await fastify.register(registerSiemSseRoutes);
  await fastify.register(exceptionsRoutes);
  await fastify.register(apiKeysRoutes, { prefix: '/api/v1/projects' });
  await fastify.register(receiversRoutes, { prefix: '/api/v1/projects' });
  await fastify.register(receiversIngestRoutes, { prefix: '/api/v1/receivers' });
  await fastify.register(dashboardRoutes);
  await fastify.register(adminRoutes, { prefix: '/api/v1/admin' });
  await fastify.register(settingsRoutes, { prefix: '/api/v1/admin/settings' });
  await fastify.register(auditLogRoutes, { prefix: '/api/v1/audit-log' });
  await fastify.register(retentionRoutes, { prefix: '/api/v1/admin' });
  await fastify.register(adminEntitlementsRoutes, { prefix: '/api/v1/admin' });

  await fastify.register(authPlugin);
  await fastify.register(contextPlugin);
  await fastify.register(streamTicketRoutes);
  await fastify.register(ingestionRoutes);
  await fastify.register(queryRoutes);
  await fastify.register(correlationRoutes, { prefix: '/api' });
  await fastify.register(patternRoutes, { prefix: '/api' });
  await fastify.register(piiMaskingRoutes, { prefix: '/api' });
  await fastify.register(pipelineRoutes, { prefix: '/api/v1/log-pipelines' });
  await fastify.register(customDashboardsRoutes, { prefix: '/api/v1/custom-dashboards' });
  await fastify.register(usageRoutes, { prefix: '/api/v1/usage' });
  await fastify.register(capabilitiesRoutes, { prefix: '/api/v1/capabilities' });
  await fastify.register(otlpRoutes);
  await fastify.register(otlpTraceRoutes);
  await fastify.register(otlpMetricRoutes);
  await fastify.register(tracesRoutes);
  await fastify.register(metricsRoutes, { prefix: '/api/v1/metrics' });
  await fastify.register(sessionsRoutes, { prefix: '/api/v1/sessions' });
  await fastify.register(sourcemapsRoutes);
  await fastify.register(websocketPlugin);
  await fastify.register(websocketRoutes);
  await fastify.register(monitoringRoutes, { prefix: '/api/v1/monitors' });
  await fastify.register(heartbeatRoutes, { prefix: '/api/v1/monitors' });
  await fastify.register(publicStatusRoutes, { prefix: '/api/v1/status' });
  await fastify.register(statusIncidentRoutes, { prefix: '/api/v1/status-incidents' });
  await fastify.register(maintenanceRoutes, { prefix: '/api/v1/maintenances' });

  return fastify;
}

async function start() {
  validateStorageConfig();

  await loadExternalHooks();
  await bootstrapService.runInitialBootstrap();
  await initializeInternalLogging();
  auditLogService.start();
  await enrichmentService.initialize();
  await notificationManager.initialize(config.DATABASE_URL);
  meteringRecorder.start();
  quotaEvaluator.start();
  storageSnapshotJob.start();

  const authMode = await settingsService.getAuthMode();
  if (authMode === 'none') {
    console.log('[Auth] Auth-free mode detected, ensuring default setup...');
    await bootstrapService.ensureDefaultSetup();
  }

  const app = await build();

  const shutdown = async () => {
    console.log('[Server] Shutting down gracefully...');
    quotaEvaluator.stop();
    storageSnapshotJob.stop();
    await meteringRecorder.stop();
    await auditLogService.shutdown();
    await notificationManager.shutdown();
    await shutdownInternalLogging();
    await Promise.all([app.close(), shutdownReservoir()]);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());

  try {
    await app.listen({ port: PORT, host: HOST });

    // Print startup banner
    try {
      const bannerPath = path.resolve(__serverDirname, '../ascii.txt');
      const banner = readFileSync(bannerPath, 'utf-8');
      console.log(banner);
    } catch { /* ascii art file missing, skip */ }
    console.log(`  LogTide v${packageJson.version} running on ${HOST}:${PORT}\n`);

    // Fire-and-forget: one-shot backfill of project data-availability flags.
    // Guarded by system_settings so subsequent boots return immediately.
    runDataAvailabilityBackfill().catch((err) => {
      console.error('[data-availability] Backfill crashed:', err);
    });
  } catch (err) {
    (app.log as any).error(err as Error);
    await shutdownInternalLogging();
    process.exit(1);
  }
}

// Start the server directly when this file is run
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start();
}
