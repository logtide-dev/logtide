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

  // Redis
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // API
  API_KEY_SECRET: z.string().min(32),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().default('587').transform(Number),
  SMTP_SECURE: z.string().default('false').transform((val) => val === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().default('noreply@logward.local'),

  // Rate limiting
  RATE_LIMIT_MAX: z.string().default('1000').transform(Number),
  RATE_LIMIT_WINDOW: z.string().default('60000').transform(Number), // 1 minute in ms

  // Auth rate limiting (separate from general rate limiting for security)
  AUTH_RATE_LIMIT_REGISTER: z.string().default('10').transform(Number), // Registrations per window
  AUTH_RATE_LIMIT_LOGIN: z.string().default('20').transform(Number), // Login attempts per window
  AUTH_RATE_LIMIT_WINDOW: z.string().default('900000').transform(Number), // 15 minutes in ms

  // Caching
  CACHE_ENABLED: z.string().default('true').transform((val) => val === 'true'),
  CACHE_TTL: z.string().default('60').transform(Number), // Default TTL in seconds

  // Initial Admin (for first deployment - creates admin user if no users exist)
  INITIAL_ADMIN_EMAIL: z.string().email().optional(),
  INITIAL_ADMIN_PASSWORD: z.string().min(8).optional(),
  INITIAL_ADMIN_NAME: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid configuration:');
    console.error(result.error.format());
    throw new Error('Invalid configuration');
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
  return !!(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS);
}
