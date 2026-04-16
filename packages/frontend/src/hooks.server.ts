import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { logtideHandle, logtideHandleError, logtideHandleFetch } from '@logtide/sveltekit';
import { hub } from '@logtide/core';

/**
 * Server hook to inject runtime configuration into the HTML.
 * This allows the API URL to be configured at runtime via Docker environment variables.
 *
 * When PUBLIC_API_URL is empty or not set, the frontend will use relative URLs,
 * which works when frontend and backend are behind the same reverse proxy.
 */
const configHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => {
      // Get API URL from environment variable at runtime
      // Empty string means same-origin (relative URLs) - ideal for reverse proxy setup
      // If not set at all, use empty string to enable same-origin by default in production
      const apiUrl = env.PUBLIC_API_URL ?? '';

      // Inject the config script before the closing </head> tag
      const configScript = `<script>window.__LOGTIDE_CONFIG__={apiUrl:${JSON.stringify(apiUrl)}}</script>`;

      return html.replace('</head>', `${configScript}</head>`);
    },
  });

  return response;
};

/**
 * Request logging handle - captures each HTTP request as a log entry.
 * logtideHandle() only creates spans (traces), this adds the missing log emission.
 */
const requestLogHandle: Handle = async ({ event, resolve }) => {
  const client = hub.getClient();
  if (!client) return resolve(event);

  const start = Date.now();
  const method = event.request.method;
  const pathname = event.url.pathname;

  let response: Response;
  try {
    response = await resolve(event);
  } catch (error) {
    const duration = Date.now() - start;
    const scope = (event.locals as any).__logtideScope;
    client.captureLog('error', `${method} ${pathname} 500 ${duration}ms`, {
      'http.method': method,
      'http.url': event.url.href,
      'http.target': pathname,
      'http.status_code': 500,
      'http.duration_ms': duration,
    }, scope);
    throw error;
  }

  const duration = Date.now() - start;
  const scope = (event.locals as any).__logtideScope;
  const level = response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info';

  client.captureLog(level, `${method} ${pathname} ${response.status} ${duration}ms`, {
    'http.method': method,
    'http.url': event.url.href,
    'http.target': pathname,
    'http.status_code': response.status,
    'http.duration_ms': duration,
  }, scope);

  return response;
};

// Compose LogTide SDK hooks with existing config injection
const dsn = privateEnv?.LOGTIDE_DSN || '';

export const handle = dsn
  ? sequence(
      logtideHandle({
        dsn,
        service: 'logtide-frontend',
        environment: privateEnv?.NODE_ENV || 'production',
        release: process.env.npm_package_version || '0.9.1',      }) as unknown as Handle,
      requestLogHandle,
      configHandle
    )
  : configHandle;

export const handleError = dsn ? logtideHandleError() : undefined;
export const handleFetch = dsn ? logtideHandleFetch() : undefined;
