import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

/**
 * Server hook to inject runtime configuration into the HTML.
 * This allows the API URL to be configured at runtime via Docker environment variables.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => {
      // Get API URL from environment variable at runtime
      const apiUrl = env.PUBLIC_API_URL || 'http://localhost:8080';

      // Inject the config script before the closing </head> tag
      const configScript = `<script>window.__LOGWARD_CONFIG__={apiUrl:"${apiUrl}"}</script>`;

      return html.replace('</head>', `${configScript}</head>`);
    },
  });

  return response;
};
