import { describe, it, expect } from 'vitest';
import { API_KEY_PLACEHOLDER, buildDsn, resolveEndpoints } from './endpoints';

describe('resolveEndpoints', () => {
  it('uses the page origin for an empty api url (reverse proxy)', () => {
    const e = resolveEndpoints('', 'https://app.logtide.dev');
    expect(e.scheme).toBe('https');
    expect(e.host).toBe('app.logtide.dev');
    expect(e.hostname).toBe('app.logtide.dev');
    expect(e.port).toBe(443);
    expect(e.tls).toBe(true);
    expect(e.basePath).toBe('');
    expect(e.ingestUrl).toBe('https://app.logtide.dev/api/v1/ingest');
  });

  it('handles an http install on a non-standard port', () => {
    const e = resolveEndpoints('http://localhost:8080', 'http://localhost:3000');
    expect(e.scheme).toBe('http');
    expect(e.port).toBe(8080);
    expect(e.tls).toBe(false);
    expect(e.host).toBe('localhost:8080');
    expect(buildDsn(e, 'lp_k')).toBe('http://lp_k@localhost:8080');
  });

  it('keeps port and base path, trimming trailing slashes', () => {
    const e = resolveEndpoints('https://api.example.com:8443/logtide/', 'https://x.test');
    expect(e.basePath).toBe('/logtide');
    expect(e.port).toBe(8443);
    expect(e.ingestUrl).toBe('https://api.example.com:8443/logtide/api/v1/ingest');
    expect(buildDsn(e, 'lp_k')).toBe('https://lp_k@api.example.com:8443/logtide');
  });

  it('strips IPv6 brackets from hostname but keeps them in host', () => {
    const e = resolveEndpoints('http://[::1]:8080', 'http://[::1]:3000');
    expect(e.hostname).toBe('::1');
    expect(e.host).toBe('[::1]:8080');
    expect(e.port).toBe(8080);
  });

  it('defaults the port by scheme', () => {
    expect(resolveEndpoints('http://example.com', 'http://example.com').port).toBe(80);
    expect(resolveEndpoints('https://example.com', 'https://example.com').port).toBe(443);
  });

  it('uses the placeholder DSN when there is no key', () => {
    const e = resolveEndpoints('https://example.com', 'https://example.com');
    expect(buildDsn(e, null)).toBe(`https://${API_KEY_PLACEHOLDER}@example.com`);
  });

  it('puts otlp urls outside /api/v1', () => {
    const e = resolveEndpoints('https://example.com/lt', 'https://example.com');
    expect(e.otlpLogsUrl).toBe('https://example.com/lt/v1/otlp/logs');
    expect(e.otlpTracesUrl).toMatch(/\/v1\/otlp\/traces$/);
    expect(e.otlpMetricsUrl).toMatch(/\/v1\/otlp\/metrics$/);
  });
});
