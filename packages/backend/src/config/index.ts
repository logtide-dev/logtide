import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { z } from 'zod';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.test first if NODE_ENV=test
if (process.env.NODE_ENV === 'test') {
  const envTestPath = path.resolve(__dirname, '../../.env.test');
  dotenv.config({ path: envTestPath, override: true });
} else {
  // Load .env from project root for development/production
  const envPath = path.resolve(__dirname, '../../../../.env');
  dotenv.config({ path: envPath, debug: false });
}

const configSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('8080').transform(Number),
  HOST: z.string().default('0.0.0.0'),
  // Trust proxy headers (X-Forwarded-For, etc.) - enable when behind reverse proxy
  TRUST_PROXY: z.string().default('false').transform((val) => val === 'true'),
  // Frontend URL for OIDC redirects (defaults to localhost:5173 in development)
  FRONTEND_URL: z.string().url().optional(),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis (optional - if not set, uses PostgreSQL-based job queue)
  REDIS_URL: z.string().url().optional(),

  // API
  API_KEY_SECRET: z.string().min(32),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().default('587').transform(Number),
  SMTP_SECURE: z.string().default('false').transform((val) => val === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().default('noreply@logtide.local'),

  // Rate limiting
  RATE_LIMIT_MAX: z.string().default('1000').transform(Number),
  RATE_LIMIT_WINDOW: z.string().default('60000').transform(Number), // 1 minute in ms

  // Auth rate limiting (separate from general rate limiting for security)
  AUTH_RATE_LIMIT_REGISTER: z.string().default('10').transform(Number), // Registrations per window
  AUTH_RATE_LIMIT_LOGIN: z.string().default('20').transform(Number), // Login attempts per window
  AUTH_RATE_LIMIT_WINDOW: z.string().default('900000').transform(Number), // 15 minutes in ms

  // Error notifications
  // Cooldown between alerts for the same error group, so a high-frequency
  // error doesn't spam one email per occurrence. Set to 0 to notify every time.
  ERROR_NOTIFICATION_COOLDOWN_MINUTES: z.string().default('15').transform(Number),

  // Caching
  CACHE_ENABLED: z.string().default('true').transform((val) => val === 'true'),
  CACHE_TTL: z.string().default('60').transform(Number), // Default TTL in seconds

  // Metering / resource usage tracking (#212)
  METERING_ENABLED: z.string().default('true').transform((val) => val === 'true'),
  METERING_FLUSH_INTERVAL_MS: z.string().default('5000').transform(Number),
  METERING_FLUSH_MAX_BUFFER: z.string().default('500').transform(Number),

  // Capability usage-quota evaluator (#214). Periodic job that flags over-quota orgs.
  QUOTA_EVALUATOR_ENABLED: z.string().default('true').transform((val) => val === 'true'),
  QUOTA_EVALUATOR_INTERVAL_MS: z.string().default('60000').transform(Number),

  // Storage snapshot job (#212 follow-up). Periodic per-project stored-bytes estimate.
  STORAGE_SNAPSHOT_ENABLED: z.string().default('true').transform((val) => val === 'true'),
  STORAGE_SNAPSHOT_INTERVAL_MS: z.string().default('86400000').transform(Number),

  // Outbound SSRF guard. By default, HTTP/TCP monitors and webhook delivery
  // reject loopback/private/link-local/reserved targets. Self-hosted
  // deployments that legitimately monitor internal services can opt in.
  MONITOR_ALLOW_PRIVATE_TARGETS: z.string().default('false').transform((val) => val === 'true'),

  // Outbound webhook dispatcher (#218).
  WEBHOOK_MAX_ATTEMPTS: z.string().default('5').transform(Number),
  WEBHOOK_PER_ORG_CONCURRENCY: z.string().default('5').transform(Number),
  WEBHOOK_GLOBAL_CONCURRENCY: z.string().default('50').transform(Number),
  WEBHOOK_DELIVERY_LOG_LIMIT: z.string().default('1000').transform(Number),
  WEBHOOK_REQUEST_TIMEOUT_MS: z.string().default('10000').transform(Number),

  // Lifecycle hooks (#216). Comma-separated paths to .js/.mjs modules loaded
  // at boot (server AND worker). Each default-exports (hooks) => void.
  // A missing or throwing module is FATAL at boot, by design.
  HOOKS_MODULES: z.string().optional(),

  // Initial Admin (for first deployment - creates admin user if no users exist)
  INITIAL_ADMIN_EMAIL: z.string().email().optional(),
  INITIAL_ADMIN_PASSWORD: z.string().min(8).optional(),
  INITIAL_ADMIN_NAME: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

// Exported for testing
export { configSchema };

/**
 * Format configuration errors with helpful hints for common issues.
 * Exported for testing.
 */
export function formatConfigError(error: z.ZodError): string {
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════════════════════',
    'CONFIGURATION ERROR - Backend cannot start',
    '═══════════════════════════════════════════════════════════════',
    '',
    'Please check your .env file for the following issues:',
    '',
  ];

  const errors = error.flatten().fieldErrors;
  for (const [field, messages] of Object.entries(errors)) {
    lines.push(`  • ${field}: ${messages?.join(', ')}`);

    // Provide helpful hints for common issues
    if (field === 'API_KEY_SECRET') {
      lines.push(`    → Must be at least 32 characters. Generate with: openssl rand -base64 32`);
    }
    if (field === 'DATABASE_URL') {
      lines.push(`    → Check that DB_USER, DB_PASSWORD, and DB_NAME are set in .env`);
    }
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    console.error(formatConfigError(result.error));
    throw new Error('Invalid configuration - see error details above');
  }

  return result.data;
}

export const config = loadConfig();

export function isDevelopment(): boolean {
  return config.NODE_ENV === 'development';
}

export function isProduction(): boolean {
  return config.NODE_ENV === 'production';
}

export function isTest(): boolean {
  return config.NODE_ENV === 'test';
}

export function isSmtpConfigured(): boolean {
  return !!config.SMTP_HOST;
}

export function isRedisConfigured(): boolean {
  return !!config.REDIS_URL;
}
