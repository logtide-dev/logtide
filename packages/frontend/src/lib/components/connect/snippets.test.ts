import { describe, it, expect } from 'vitest';
import { resolveEndpoints, API_KEY_PLACEHOLDER } from './endpoints';
import { PLATFORMS, buildSnippets, type PlatformId } from './snippets';

const https = resolveEndpoints('https://logs.example.com', 'https://logs.example.com');
const http = resolveEndpoints('http://localhost:8080', 'http://localhost:3000');

function all(platform: PlatformId, ctx: Parameters<typeof buildSnippets>[1]): string {
  return buildSnippets(platform, ctx)
    .map((s) => s.code)
    .join('\n');
}

describe('buildSnippets', () => {
  it('lists eleven platforms in order', () => {
    expect(PLATFORMS.map((p) => p.label)).toEqual([
      'Node.js',
      'Python',
      'Go',
      'Ruby',
      'PHP',
      'Java / Kotlin',
      '.NET',
      'Browser JS',
      'OpenTelemetry OTLP',
      'Fluent Bit',
      'cURL',
    ]);
  });

  it.each(PLATFORMS)('$label returns snippets that contain the key', ({ id }) => {
    const withKey = buildSnippets(id, { endpoints: https, apiKey: 'lp_abc123', service: 'svc' });
    expect(withKey.length).toBeGreaterThan(0);
    expect(withKey.map((s) => s.code).join('\n')).toContain('lp_abc123');

    const placeholder = all(id, { endpoints: https, apiKey: null, service: 'svc' });
    expect(placeholder).toContain(API_KEY_PLACEHOLDER);
  });

  it('uses the documented package names', () => {
    const ctx = { endpoints: https, apiKey: 'lp_k', service: 'svc' };
    expect(all('nodejs', ctx)).toContain('npm install @logtide/core');
    expect(all('nodejs', ctx)).toContain('hub.init(');
    expect(all('python', ctx)).toContain('pip install logtide-sdk');
    expect(all('python', ctx)).toContain('from logtide_sdk import LogTideClient, ClientOptions');
    expect(all('go', ctx)).toContain('go get github.com/logtide-dev/logtide-sdk-go');
    expect(all('go', ctx)).toContain('logtide.Init(logtide.ClientOptions{');
    expect(all('ruby', ctx)).toContain('gem "logtide"');
    expect(all('ruby', ctx)).toContain('Logtide.init(');
    expect(all('php', ctx)).toContain('composer require logtide/logtide');
    expect(all('php', ctx)).toContain('\\LogTide\\init([');
    expect(all('java', ctx)).toContain('io.github.logtide-dev:logtide-sdk-kotlin:');
    expect(all('java', ctx)).toContain('LogTideClient(');
    expect(all('dotnet', ctx)).toContain('dotnet add package LogTide.SDK');
    expect(all('dotnet', ctx)).toContain('LogTideClient.FromDsn(');
    expect(all('browser', ctx)).toContain('npm install @logtide/browser');
    expect(all('browser', ctx)).toContain('initLogtide({');
  });

  it("python snippet does not use the wrong 'from logtide import'", () => {
    const code = all('python', { endpoints: https, apiKey: 'lp_k', service: 'svc' });
    expect(code).not.toContain('from logtide import');
  });

  it('otlp snippet targets the /v1/otlp endpoints with the key header', () => {
    const code = all('otlp', { endpoints: https, apiKey: 'lp_k', service: 'svc' });
    expect(code).toContain('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://logs.example.com/v1/otlp/logs');
    expect(code).toContain('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://logs.example.com/v1/otlp/traces');
    expect(code).toContain('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=https://logs.example.com/v1/otlp/metrics');
    expect(code).toContain('OTEL_EXPORTER_OTLP_HEADERS=X-API-Key=lp_k');
    expect(code).toContain('OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf');
  });

  it('fluent bit over http has Port 8080 and tls Off', () => {
    const code = all('fluent-bit', { endpoints: http, apiKey: 'lp_k', service: 'svc' });
    expect(code).toMatch(/Host\s+localhost/);
    expect(code).toMatch(/Port\s+8080/);
    expect(code).toMatch(/tls\s+Off/);
    expect(code).toMatch(/URI\s+\/api\/v1\/ingest/);
  });

  it('fluent bit over https has Port 443 and tls On', () => {
    const code = all('fluent-bit', { endpoints: https, apiKey: 'lp_k', service: 'svc' });
    expect(code).toMatch(/Port\s+443/);
    expect(code).toMatch(/tls\s+On/);
  });

  it('fluent bit keeps the base path in the URI and strips ipv6 brackets from Host', () => {
    const e = resolveEndpoints('http://[::1]:8080/lt', 'http://[::1]:3000');
    const code = all('fluent-bit', { endpoints: e, apiKey: 'lp_k', service: 'svc' });
    expect(code).toMatch(/Host\s+::1\n/);
    expect(code).toMatch(/URI\s+\/lt\/api\/v1\/ingest/);
  });

  it('curl snippet body is valid JSON with a real log record', () => {
    const code = all('curl', { endpoints: https, apiKey: 'lp_k', service: 'my-app' });
    expect(code).toContain('Content-Type: application/json');
    expect(code).toContain('X-API-Key: lp_k');
    const start = code.indexOf("-d '") + 4;
    const end = code.lastIndexOf("'");
    const body = JSON.parse(code.slice(start, end));
    expect(body.logs[0]).toMatchObject({ level: 'info', service: 'my-app' });
    expect(typeof body.logs[0].message).toBe('string');
    expect(Number.isNaN(Date.parse(body.logs[0].time))).toBe(false);
    expect(code).toContain('"https://logs.example.com/api/v1/ingest"');
  });

  it('no snippet contains the https scheme for an http install', () => {
    for (const { id } of PLATFORMS) {
      const code = all(id, { endpoints: http, apiKey: 'lp_k', service: 'svc' });
      expect(code, id).not.toContain('https://');
    }
  });
});
