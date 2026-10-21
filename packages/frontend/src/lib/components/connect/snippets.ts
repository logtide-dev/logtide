import { API_KEY_PLACEHOLDER, buildDsn, type ConnectEndpoints } from './endpoints';

export type PlatformId =
  | 'nodejs'
  | 'python'
  | 'go'
  | 'ruby'
  | 'php'
  | 'java'
  | 'dotnet'
  | 'browser'
  | 'otlp'
  | 'fluent-bit'
  | 'curl';

export const PLATFORMS: { id: PlatformId; label: string }[] = [
  { id: 'nodejs', label: 'Node.js' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'php', label: 'PHP' },
  { id: 'java', label: 'Java / Kotlin' },
  { id: 'dotnet', label: '.NET' },
  { id: 'browser', label: 'Browser JS' },
  { id: 'otlp', label: 'OpenTelemetry OTLP' },
  { id: 'fluent-bit', label: 'Fluent Bit' },
  { id: 'curl', label: 'cURL' },
];

export interface Snippet {
  title: string;
  language: string;
  code: string;
}

export interface SnippetContext {
  endpoints: ConnectEndpoints;
  apiKey: string | null;
  service: string;
  /** Timestamp used in the cURL body; defaults to now. */
  now?: Date;
}

/** Version published on Maven Central (the README still says 0.2.0, which was never published). */
export const KOTLIN_SDK_VERSION = '0.4.0';

function js(value: string): string {
  return JSON.stringify(value);
}

export function buildSnippets(platform: PlatformId, ctx: SnippetContext): Snippet[] {
  const { endpoints: e, service } = ctx;
  const key = ctx.apiKey ?? API_KEY_PLACEHOLDER;
  const dsn = buildDsn(e, ctx.apiKey);

  switch (platform) {
    case 'nodejs':
      return [
        { title: 'Install', language: 'bash', code: 'npm install @logtide/core' },
        {
          title: 'Initialize',
          language: 'typescript',
          code: [
            "import { hub } from '@logtide/core';",
            '',
            'hub.init({',
            `  dsn: ${js(dsn)},`,
            `  service: ${js(service)},`,
            '});',
            '',
            "hub.captureLog('info', 'Hello from LogTide', { source: 'onboarding' });",
          ].join('\n'),
        },
      ];
    case 'python':
      return [
        { title: 'Install', language: 'bash', code: 'pip install logtide-sdk' },
        {
          title: 'Initialize',
          language: 'python',
          code: [
            'from logtide_sdk import LogTideClient, ClientOptions',
            '',
            'client = LogTideClient(',
            '    ClientOptions(',
            `        api_url=${js(e.apiUrl)},`,
            `        api_key=${js(key)},`,
            '    )',
            ')',
            '',
            `client.info(${js(service)}, 'Hello from LogTide', {'source': 'onboarding'})`,
          ].join('\n'),
        },
      ];
    case 'go':
      return [
        { title: 'Install', language: 'bash', code: 'go get github.com/logtide-dev/logtide-sdk-go' },
        {
          title: 'Initialize',
          language: 'go',
          code: [
            'package main',
            '',
            'import (',
            '    "context"',
            '',
            '    logtide "github.com/logtide-dev/logtide-sdk-go"',
            ')',
            '',
            'func main() {',
            '    flush := logtide.Init(logtide.ClientOptions{',
            `        DSN:     ${js(dsn)},`,
            `        Service: ${js(service)},`,
            '    })',
            '    defer flush()',
            '',
            '    logtide.Info(context.Background(), "Hello from LogTide", nil)',
            '}',
          ].join('\n'),
        },
      ];
    case 'ruby':
      return [
        { title: 'Install', language: 'ruby', code: 'gem "logtide"' },
        {
          title: 'Initialize',
          language: 'ruby',
          code: [
            'require "logtide"',
            '',
            'Logtide.init(',
            `  dsn: ${js(dsn)},`,
            `  service: ${js(service)}`,
            ')',
            '',
            'Logtide.info("Hello from LogTide", { source: "onboarding" })',
          ].join('\n'),
        },
      ];
    case 'php':
      return [
        { title: 'Install', language: 'bash', code: 'composer require logtide/logtide' },
        {
          title: 'Initialize',
          language: 'php',
          code: [
            '<?php',
            '',
            '\\LogTide\\init([',
            `    'dsn' => ${phpString(dsn)},`,
            `    'service' => ${phpString(service)},`,
            ']);',
          ].join('\n'),
        },
      ];
    case 'java':
      return [
        {
          title: 'Install',
          language: 'kotlin',
          code: `implementation("io.github.logtide-dev:logtide-sdk-kotlin:${KOTLIN_SDK_VERSION}")`,
        },
        {
          title: 'Initialize',
          language: 'kotlin',
          code: [
            'import dev.logtide.sdk.LogTideClient',
            'import dev.logtide.sdk.models.LogTideClientOptions',
            '',
            'val client = LogTideClient(',
            '    LogTideClientOptions(',
            `        apiUrl = ${js(e.apiUrl)},`,
            `        apiKey = ${js(key)}`,
            '    )',
            ')',
            '',
            `client.info(${js(service)}, "Hello from LogTide")`,
          ].join('\n'),
        },
      ];
    case 'dotnet':
      return [
        { title: 'Install', language: 'bash', code: 'dotnet add package LogTide.SDK' },
        {
          title: 'Initialize',
          language: 'csharp',
          code: [
            'using LogTide.SDK.Core;',
            '',
            `await using var client = LogTideClient.FromDsn(${js(dsn)});`,
            '',
            `client.Info(${js(service)}, "Hello from LogTide");`,
          ].join('\n'),
        },
      ];
    case 'browser':
      return [
        { title: 'Install', language: 'bash', code: 'npm install @logtide/browser' },
        {
          title: 'Initialize',
          language: 'typescript',
          code: [
            "import { initLogtide } from '@logtide/browser';",
            '',
            'initLogtide({',
            `  dsn: ${js(dsn)},`,
            `  service: ${js(service)},`,
            '});',
          ].join('\n'),
        },
      ];
    case 'otlp':
      return [
        {
          title: 'Environment variables',
          language: 'bash',
          code: [
            'export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
            `export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=${e.otlpLogsUrl}`,
            `export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${e.otlpTracesUrl}`,
            `export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=${e.otlpMetricsUrl}`,
            `export OTEL_EXPORTER_OTLP_HEADERS=X-API-Key=${key}`,
            `export OTEL_SERVICE_NAME=${service}`,
          ].join('\n'),
        },
      ];
    case 'fluent-bit':
      return [
        {
          title: 'Output section',
          language: 'ini',
          code: [
            '[OUTPUT]',
            '    Name              http',
            '    Match             *',
            `    Host              ${e.hostname}`,
            `    Port              ${e.port}`,
            `    URI               ${e.basePath}/api/v1/ingest`,
            '    Format            json',
            '    Json_date_key     time',
            '    Json_date_format  iso8601',
            `    Header            X-API-Key ${key}`,
            '    Header            Content-Type application/json',
            `    tls               ${e.tls ? 'On' : 'Off'}`,
          ].join('\n'),
        },
      ];
    case 'curl': {
      const body = JSON.stringify({
        logs: [
          {
            time: (ctx.now ?? new Date()).toISOString(),
            level: 'info',
            service,
            message: 'Hello from LogTide',
          },
        ],
      });
      return [
        {
          title: 'Send a test log',
          language: 'bash',
          code: [
            `curl -X POST ${shellQuote(e.ingestUrl)} \\`,
            '  -H "Content-Type: application/json" \\',
            `  -H ${shellQuote('X-API-Key: ' + key)} \\`,
            `  -d '${body.replace(/'/g, "'\\''")}'`,
          ].join('\n'),
        },
      ];
    }
  }
}

function phpString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}
