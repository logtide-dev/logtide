export const API_KEY_PLACEHOLDER = 'YOUR_API_KEY';

export interface ConnectEndpoints {
  /** API origin plus base path, no trailing slash. */
  apiUrl: string;
  scheme: 'http' | 'https';
  /** Host as it appears in a URL: IPv6 keeps its brackets, port omitted when default. */
  host: string;
  /** Hostname only, IPv6 brackets stripped. */
  hostname: string;
  port: number;
  tls: boolean;
  /** Path prefix the API is mounted under, '' when none. */
  basePath: string;
  ingestUrl: string;
  otlpLogsUrl: string;
  otlpTracesUrl: string;
  otlpMetricsUrl: string;
}

/**
 * Resolve the endpoints a client must use to reach this install.
 * An empty `apiUrl` means same origin (reverse proxy), as `getApiUrl()` returns.
 */
export function resolveEndpoints(apiUrl: string, origin: string): ConnectEndpoints {
  let url: URL;
  try {
    url = new URL(apiUrl || origin, origin);
  } catch {
    url = new URL(origin);
  }

  const scheme: 'http' | 'https' = url.protocol === 'http:' ? 'http' : 'https';
  const tls = scheme === 'https';
  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  const port = url.port ? Number(url.port) : tls ? 443 : 80;
  const basePath = url.pathname.replace(/\/+$/, '');
  const base = `${scheme}://${url.host}${basePath}`;

  return {
    apiUrl: base,
    scheme,
    host: url.host,
    hostname,
    port,
    tls,
    basePath,
    ingestUrl: `${base}/api/v1/ingest`,
    otlpLogsUrl: `${base}/v1/otlp/logs`,
    otlpTracesUrl: `${base}/v1/otlp/traces`,
    otlpMetricsUrl: `${base}/v1/otlp/metrics`,
  };
}

/** DSN in the form `<scheme>://<key>@<host><basePath>`. */
export function buildDsn(e: ConnectEndpoints, apiKey: string | null): string {
  return `${e.scheme}://${apiKey ?? API_KEY_PLACEHOLDER}@${e.host}${e.basePath}`;
}
