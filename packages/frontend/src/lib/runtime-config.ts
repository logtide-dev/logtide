export interface RuntimeConfig {
  apiUrl?: string;
  apiPort?: string;
}

/**
 * The config injected into every page.
 *
 * PUBLIC_API_URL=auto leaves apiUrl out, so the browser works out the backend
 * address from the page it is on (see getApiUrl), using the backend's host port.
 * Any other value is used as it is; empty or unset means same origin.
 */
export function buildRuntimeConfig(
  publicApiUrl: string | undefined,
  backendPort: string | undefined
): RuntimeConfig {
  if (publicApiUrl === 'auto') {
    return backendPort ? { apiPort: backendPort } : {};
  }
  return { apiUrl: publicApiUrl ?? '' };
}
