import { goto } from '$app/navigation';
import { authStore } from '$lib/stores/auth';
import { getAuthToken } from '$lib/utils/auth';

/**
 * Global 401 handler.
 *
 * The ~30 API client wrappers all call window.fetch directly and there is no
 * shared HTTP client to hook into. Rather than route every client through a new
 * wrapper, we install a single fetch interceptor once at app startup: when any
 * authenticated API request comes back 401 (revoked or expired session), we
 * clear the local auth state and bounce the user to the login page, preserving
 * where they were so they land back there after signing in.
 *
 * Without this, a dead session was only detected on a full dashboard remount, so
 * a user could keep clicking around a logged-out app getting silent failures.
 */

let installed = false;
// Guards against a burst of concurrent 401s (e.g. several parallel requests)
// all triggering a logout + navigation at once.
let handling = false;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

function isApiRequest(url: string): boolean {
  return url.includes('/api/v1/');
}

// Auth flows (login, register, OIDC, LDAP, admin auth) manage their own 401s and
// must not be treated as an expired session.
function isAuthEndpoint(url: string): boolean {
  return url.includes('/auth/');
}

// Ingestion / telemetry endpoints authenticate with an API key or DSN, not the
// session. A 401 here means a bad or expired telemetry key (e.g. the client-side
// SDK in hooks.client.ts, or an inbound receiver), NOT an expired user session,
// so it must never log the user out. Otherwise a misconfigured browser SDK key
// bounces the user to /login on every page view.
function isTelemetryEndpoint(url: string): boolean {
  return (
    url.includes('/api/v1/ingest') ||
    url.includes('/v1/otlp/') ||
    url.includes('/api/v1/receivers/')
  );
}

function handleUnauthorized(): void {
  if (handling) return;
  handling = true;

  authStore.clearAuth();

  const onLoginPage = window.location.pathname.startsWith('/login');
  if (!onLoginPage) {
    const current = window.location.pathname + window.location.search;
    const target = `/login?redirect=${encodeURIComponent(current)}`;
    // Prefer SvelteKit navigation; fall back to a hard redirect if it fails.
    Promise.resolve(goto(target)).catch(() => {
      window.location.href = target;
    });
  }

  // Allow future handling once this logout cycle has settled.
  window.setTimeout(() => {
    handling = false;
  }, 1000);
}

export function installAuthFetchInterceptor(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);

    try {
      if (
        response.status === 401 &&
        getAuthToken() &&
        isApiRequest(urlOf(input)) &&
        !isAuthEndpoint(urlOf(input)) &&
        !isTelemetryEndpoint(urlOf(input))
      ) {
        handleUnauthorized();
      }
    } catch {
      // Never let interceptor logic break a fetch call.
    }

    return response;
  };
}
