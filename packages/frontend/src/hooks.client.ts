import { hub } from '@logtide/core';
import { initLogtide, logtideHandleError } from '@logtide/sveltekit';
import { env } from '$env/dynamic/public';

// Initialize client-side logging with full browser SDK features
const dsn = env.PUBLIC_LOGTIDE_DSN || '';
if (dsn) {
  initLogtide({
    dsn,
    service: 'logtide-frontend-client',
    environment: env.PUBLIC_NODE_ENV || 'production',
    release: env.PUBLIC_APP_VERSION || '0.9.1',
    debug: env.PUBLIC_NODE_ENV === 'development',
    browser: {
      // Core Web Vitals (LCP, INP, CLS, TTFB)
      webVitals: true,
      webVitalsSampleRate: 1.0,
      // Track user clicks/inputs as breadcrumbs
      clickBreadcrumbs: true,
      // Track fetch/XHR as breadcrumbs (auto-skips logtide API)
      networkBreadcrumbs: { captureQueryParams: false },
      // Buffer logs offline, flush on reconnect + sendBeacon on unload
      offlineResilience: true,
    },
  });

  // Capture initial page load
  const client = hub.getClient();
  if (client) {
    client.captureLog('info', `pageview ${window.location.pathname}`, {
      'page.url': window.location.href,
      'page.pathname': window.location.pathname,
      'page.referrer': document.referrer || undefined,
      'browser.userAgent': navigator.userAgent,
    });
  }
}

export const handleError = logtideHandleError();
