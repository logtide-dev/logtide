import { LogWardClient } from '@logward-dev/sdk-node';
import { getInternalApiKey } from './internal-logging-bootstrap.js';

let internalLogger: LogWardClient | null = null;
let isEnabled = false;

/**
 * Initialize internal logging client
 */
export async function initializeInternalLogging(): Promise<void> {
  // Check if internal logging is enabled
  const enabled = process.env.INTERNAL_LOGGING_ENABLED !== 'false';

  if (!enabled) {
    return;
  }

  try {
    // Get API key
    const apiKey = await getInternalApiKey();

    if (!apiKey) {
      console.warn('[Internal Logging] Skipping internal logging - no API key available');
      return;
    }

    // Determine API URL (default to localhost in development)
    const apiUrl =
      process.env.INTERNAL_LOGGING_API_URL || process.env.API_URL || 'http://localhost:8080';

    // Initialize client
    internalLogger = new LogWardClient({
      apiUrl,
      apiKey,

      // Configuration
      batchSize: 50,
      flushInterval: 10000, // 10 seconds
      maxBufferSize: 5000,

      // Retry configuration (more aggressive for internal use)
      maxRetries: 2,
      retryDelayMs: 500,

      // Circuit breaker (fail fast)
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 30000,

      // Metrics & debugging
      enableMetrics: true,
      debug: process.env.NODE_ENV === 'development',

      // Global metadata
      globalMetadata: {
        service: process.env.SERVICE_NAME || 'logward-backend',
        env: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version || '0.3.3',
        hostname: process.env.HOSTNAME || 'unknown',
      },
    });

    isEnabled = true;
  } catch (error) {
    console.error('[Internal Logging] ❌ Failed to initialize internal logging:', error);
  }
}

/**
 * Get the internal logger instance (or null if not initialized)
 */
export function getInternalLogger(): LogWardClient | null {
  return internalLogger;
}

/**
 * Check if internal logging is enabled
 */
export function isInternalLoggingEnabled(): boolean {
  return isEnabled && internalLogger !== null;
}

/**
 * Shutdown internal logging (flush pending logs)
 */
export async function shutdownInternalLogging(): Promise<void> {
  if (internalLogger) {
    await internalLogger.close();
  }
}
