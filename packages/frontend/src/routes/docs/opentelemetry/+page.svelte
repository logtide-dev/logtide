<script lang="ts">
    import Breadcrumbs from "$lib/components/docs/Breadcrumbs.svelte";
    import CodeBlock from "$lib/components/docs/CodeBlock.svelte";
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { Badge } from "$lib/components/ui/badge";
    import { ExternalLink, Check, AlertCircle } from "lucide-svelte";
</script>

<div class="docs-content">
    <Breadcrumbs />

    <div class="flex items-center justify-between mb-4">
        <h1 class="text-3xl font-bold">OpenTelemetry Integration</h1>
        <Badge variant="outline" class="text-green-600 border-green-600">
            Native OTLP Support
        </Badge>
    </div>

    <p class="text-lg text-muted-foreground mb-8">
        LogWard supports native OpenTelemetry Protocol (OTLP) for log ingestion,
        allowing you to send logs from any OpenTelemetry-instrumented application.
    </p>

    <h2
        id="overview"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Overview
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            The OTLP endpoint accepts logs in both JSON and Protobuf formats,
            making it compatible with all OpenTelemetry SDKs and collectors.
            Both content types are fully supported with automatic format detection.
        </p>

        <Card class="mb-4">
            <CardContent class="pt-4">
                <div class="grid gap-3 text-sm">
                    <div class="flex justify-between">
                        <span class="text-muted-foreground">Endpoint Path:</span>
                        <code class="font-mono">/api/v1/otlp/logs</code>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-muted-foreground">Content Types:</span>
                        <span>
                            <code>application/json</code>,
                            <code>application/x-protobuf</code>
                        </span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-muted-foreground">Authentication:</span>
                        <code class="font-mono">X-API-Key</code> header
                    </div>
                </div>
            </CardContent>
        </Card>

        <Card class="mb-4 border-blue-500/30 bg-blue-500/5">
            <CardContent class="pt-4">
                <h4 class="font-semibold mb-2">Full Endpoint URLs</h4>
                <div class="grid gap-2 text-sm">
                    <div>
                        <span class="text-muted-foreground">LogWard Cloud:</span>
                        <code class="ml-2 font-mono">https://api.logward.dev/api/v1/otlp/logs</code>
                    </div>
                    <div>
                        <span class="text-muted-foreground">Self-hosted (default):</span>
                        <code class="ml-2 font-mono">http://your-server:8080/api/v1/otlp/logs</code>
                    </div>
                    <div>
                        <span class="text-muted-foreground">Self-hosted (with TLS):</span>
                        <code class="ml-2 font-mono">https://your-server:443/api/v1/otlp/logs</code>
                    </div>
                </div>
                <p class="text-xs text-muted-foreground mt-3">
                    <strong>Note:</strong> The default backend port is <code>8080</code> (HTTP).
                    If you're using a reverse proxy with TLS, use port <code>443</code> (HTTPS).
                </p>
            </CardContent>
        </Card>
    </div>

    <h2
        id="data-mapping"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Data Mapping
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            OTLP log records are automatically mapped to LogWard's format:
        </p>

        <div class="overflow-x-auto">
            <table class="w-full text-sm border border-border rounded-lg">
                <thead class="bg-muted">
                    <tr>
                        <th class="px-4 py-2 text-left border-b border-border">OTLP Field</th>
                        <th class="px-4 py-2 text-left border-b border-border">LogWard Field</th>
                        <th class="px-4 py-2 text-left border-b border-border">Notes</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">timeUnixNano</td>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">time</td>
                        <td class="px-4 py-2 border-b border-border">Converted to ISO 8601</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">severityNumber</td>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">level</td>
                        <td class="px-4 py-2 border-b border-border">Mapped to 5 levels (see below)</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">body.stringValue</td>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">message</td>
                        <td class="px-4 py-2 border-b border-border">Log message content</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">traceId</td>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">trace_id</td>
                        <td class="px-4 py-2 border-b border-border">Converted to UUID format</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">spanId</td>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">span_id</td>
                        <td class="px-4 py-2 border-b border-border">16-character hex string</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">attributes</td>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">metadata</td>
                        <td class="px-4 py-2 border-b border-border">Stored as JSON object</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 font-mono text-xs">resource.service.name</td>
                        <td class="px-4 py-2 font-mono text-xs">service</td>
                        <td class="px-4 py-2">Extracted from resource</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <h2
        id="severity-mapping"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Severity Mapping
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            OTLP severity numbers (0-24) are mapped to LogWard levels:
        </p>

        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
                <CardContent class="pt-4 text-center">
                    <Badge variant="secondary" class="mb-2">1-8</Badge>
                    <p class="text-sm font-medium">debug</p>
                    <p class="text-xs text-muted-foreground">TRACE/DEBUG</p>
                </CardContent>
            </Card>
            <Card>
                <CardContent class="pt-4 text-center">
                    <Badge class="mb-2 bg-blue-500">9-12</Badge>
                    <p class="text-sm font-medium">info</p>
                    <p class="text-xs text-muted-foreground">INFO</p>
                </CardContent>
            </Card>
            <Card>
                <CardContent class="pt-4 text-center">
                    <Badge class="mb-2 bg-yellow-500">13-16</Badge>
                    <p class="text-sm font-medium">warn</p>
                    <p class="text-xs text-muted-foreground">WARN</p>
                </CardContent>
            </Card>
            <Card>
                <CardContent class="pt-4 text-center">
                    <Badge class="mb-2 bg-red-500">17-20</Badge>
                    <p class="text-sm font-medium">error</p>
                    <p class="text-xs text-muted-foreground">ERROR</p>
                </CardContent>
            </Card>
            <Card>
                <CardContent class="pt-4 text-center">
                    <Badge class="mb-2 bg-red-700">21-24</Badge>
                    <p class="text-sm font-medium">critical</p>
                    <p class="text-xs text-muted-foreground">FATAL</p>
                </CardContent>
            </Card>
        </div>
    </div>

    <h2
        id="nodejs"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Node.js Example
    </h2>

    <div class="mb-8">
        <p class="mb-4">Install the required packages:</p>

        <CodeBlock
            lang="bash"
            code={`npm install @opentelemetry/sdk-node @opentelemetry/api-logs \\
  @opentelemetry/sdk-logs @opentelemetry/exporter-logs-otlp-http`}
        />

        <p class="mt-6 mb-4">Configure the OpenTelemetry SDK:</p>

        <CodeBlock
            lang="typescript"
            code={`import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

// Configure the OTLP exporter
// Self-hosted: http://your-server:8080/api/v1/otlp/logs
// Cloud: https://api.logward.dev/api/v1/otlp/logs
const logExporter = new OTLPLogExporter({
  url: 'http://your-server:8080/api/v1/otlp/logs',
  headers: {
    'X-API-Key': 'your-api-key-here',
  },
});

// Initialize the SDK
const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'my-service',
  }),
  logRecordProcessor: new BatchLogRecordProcessor(logExporter),
});

sdk.start();

// Get a logger and emit logs
const logger = logs.getLogger('my-logger');

logger.emit({
  severityNumber: SeverityNumber.INFO,
  severityText: 'INFO',
  body: 'User logged in successfully',
  attributes: {
    'user.id': '12345',
    'user.email': 'user@example.com',
  },
});`}
        />
    </div>

    <h2
        id="python"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Python Example
    </h2>

    <div class="mb-8">
        <p class="mb-4">Install the required packages:</p>

        <CodeBlock
            lang="bash"
            code={`pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http`}
        />

        <p class="mt-6 mb-4">Configure the OpenTelemetry SDK:</p>

        <CodeBlock
            lang="python"
            code={`from opentelemetry import _logs
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.sdk.resources import Resource, SERVICE_NAME
import logging

# Configure the resource
resource = Resource.create({
    SERVICE_NAME: "my-python-service"
})

# Configure the OTLP exporter
# Self-hosted: http://your-server:8080/api/v1/otlp/logs
# Cloud: https://api.logward.dev/api/v1/otlp/logs
exporter = OTLPLogExporter(
    endpoint="http://your-server:8080/api/v1/otlp/logs",
    headers={"X-API-Key": "your-api-key-here"},
)

# Set up the logger provider
logger_provider = LoggerProvider(resource=resource)
logger_provider.add_log_record_processor(BatchLogRecordProcessor(exporter))
_logs.set_logger_provider(logger_provider)

# Attach to Python's logging module
handler = LoggingHandler(
    level=logging.DEBUG,
    logger_provider=logger_provider,
)

logging.getLogger().addHandler(handler)
logging.getLogger().setLevel(logging.DEBUG)

# Now all logs will be sent to LogWard
logging.info("Application started", extra={"user.id": "12345"})
logging.warning("High memory usage", extra={"memory.percent": 85})
logging.error("Database connection failed", extra={"db.host": "localhost"})`}
        />
    </div>

    <h2
        id="go"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Go Example
    </h2>

    <div class="mb-8">
        <p class="mb-4">Install the required packages:</p>

        <CodeBlock
            lang="bash"
            code={`go get go.opentelemetry.io/otel
go get go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp
go get go.opentelemetry.io/otel/sdk/log`}
        />

        <p class="mt-6 mb-4">Configure the OpenTelemetry SDK:</p>

        <CodeBlock
            lang="go"
            code={`package main

import (
    "context"
    "log"

    "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
    "go.opentelemetry.io/otel/log/global"
    sdklog "go.opentelemetry.io/otel/sdk/log"
    "go.opentelemetry.io/otel/sdk/resource"
    semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
)

func main() {
    ctx := context.Background()

    // Create the OTLP exporter
    // Self-hosted: your-server:8080 (with WithInsecure())
    // Cloud: api.logward.dev (HTTPS by default)
    exporter, err := otlploghttp.New(ctx,
        otlploghttp.WithEndpoint("your-server:8080"),
        otlploghttp.WithURLPath("/api/v1/otlp/logs"),
        otlploghttp.WithInsecure(), // Remove for HTTPS
        otlploghttp.WithHeaders(map[string]string{
            "X-API-Key": "your-api-key-here",
        }),
    )
    if err != nil {
        log.Fatalf("failed to create exporter: %v", err)
    }

    // Create resource
    res, _ := resource.New(ctx,
        resource.WithAttributes(
            semconv.ServiceName("my-go-service"),
        ),
    )

    // Create logger provider
    provider := sdklog.NewLoggerProvider(
        sdklog.WithProcessor(sdklog.NewBatchProcessor(exporter)),
        sdklog.WithResource(res),
    )
    defer provider.Shutdown(ctx)

    global.SetLoggerProvider(provider)
}`}
        />
    </div>

    <h2
        id="collector"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        OpenTelemetry Collector
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            You can use the OpenTelemetry Collector to aggregate logs from multiple
            services before sending to LogWard.
        </p>

        <CodeBlock
            lang="yaml"
            code={`# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 1s
    send_batch_size: 100

exporters:
  otlphttp/logward:
    # Self-hosted: http://your-server:8080
    # Cloud: https://api.logward.dev
    endpoint: http://your-server:8080
    headers:
      X-API-Key: your-api-key-here
    tls:
      insecure: true  # Set to false for HTTPS

service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp/logward]`}
        />

        <p class="mt-6 mb-4">Docker Compose configuration:</p>

        <CodeBlock
            lang="yaml"
            code={`version: '3.8'

services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ['--config=/etc/otel-collector-config.yaml']
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - '4317:4317'  # OTLP gRPC
      - '4318:4318'  # OTLP HTTP`}
        />
    </div>

    <h2
        id="fluent-bit"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Fluent Bit Integration
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            Fluent Bit can forward logs to LogWard using the OpenTelemetry output plugin.
            Both JSON and Protobuf formats are supported:
        </p>

        <CodeBlock
            lang="ini"
            code={`[SERVICE]
    Flush        1
    Log_Level    info

[INPUT]
    Name         tail
    Path         /var/log/app/*.log
    Tag          app.*

[OUTPUT]
    Name         opentelemetry
    Match        *
    # Self-hosted (HTTP): Host your-server, Port 8080, Tls Off
    # Cloud (HTTPS): Host api.logward.dev, Port 443, Tls On
    Host         your-server
    Port         8080
    Uri          /api/v1/otlp/logs
    Log_response_payload True
    Tls          Off
    Header       X-API-Key your-api-key-here`}
        />

        <p class="mt-4 text-sm text-muted-foreground">
            <strong>Note:</strong> LogWard supports both Protobuf (default) and JSON encoding.
            To use JSON instead, add <code>Logs_encoding json</code> to the OUTPUT section.
        </p>
    </div>

    <h2
        id="trace-correlation"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Trace Correlation
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            When sending logs with trace context, LogWard automatically extracts
            and indexes <code>trace_id</code> and <code>span_id</code> fields.
            This enables:
        </p>

        <div class="grid gap-3 mb-6">
            <Card>
                <CardContent class="pt-4 flex items-start gap-3">
                    <Check class="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                    <div>
                        <p class="font-medium">Trace-to-logs correlation</p>
                        <p class="text-sm text-muted-foreground">
                            Click on a trace ID to see all related logs
                        </p>
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardContent class="pt-4 flex items-start gap-3">
                    <Check class="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                    <div>
                        <p class="font-medium">Distributed tracing</p>
                        <p class="text-sm text-muted-foreground">
                            Follow requests across multiple services
                        </p>
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardContent class="pt-4 flex items-start gap-3">
                    <Check class="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                    <div>
                        <p class="font-medium">Context filtering</p>
                        <p class="text-sm text-muted-foreground">
                            Search logs by trace ID or span ID
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>

        <CodeBlock
            lang="typescript"
            code={`import { trace, context } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

const tracer = trace.getTracer('my-tracer');
const logger = logs.getLogger('my-logger');

// Create a span
const span = tracer.startSpan('process-request');

// Log within the span context - trace_id is auto-propagated
context.with(trace.setSpan(context.active(), span), () => {
  logger.emit({
    severityNumber: SeverityNumber.INFO,
    body: 'Processing user request',
    attributes: { 'request.id': 'req-123' },
  });
});

span.end();`}
        />
    </div>

    <h2
        id="troubleshooting"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Troubleshooting
    </h2>

    <div class="mb-8">
        <h3 id="response-codes" class="text-lg font-semibold mb-3 scroll-mt-20">Response Codes</h3>

        <div class="overflow-x-auto mb-6">
            <table class="w-full text-sm border border-border rounded-lg">
                <thead class="bg-muted">
                    <tr>
                        <th class="px-4 py-2 text-left border-b border-border">Code</th>
                        <th class="px-4 py-2 text-left border-b border-border">Meaning</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono">200</td>
                        <td class="px-4 py-2 border-b border-border">Success</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono">400</td>
                        <td class="px-4 py-2 border-b border-border">Invalid request format</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono">401</td>
                        <td class="px-4 py-2 border-b border-border">Missing or invalid API key</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono">429</td>
                        <td class="px-4 py-2 border-b border-border">Rate limit exceeded</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 font-mono">500</td>
                        <td class="px-4 py-2">Server error</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <h3 id="common-issues" class="text-lg font-semibold mb-3 scroll-mt-20">Common Issues</h3>

        <div class="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle class="text-base flex items-center gap-2">
                        <AlertCircle class="w-4 h-4 text-yellow-500" />
                        Logs Not Appearing
                    </CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    <ul class="list-disc pl-4 space-y-1">
                        <li>Check that your API key is valid and has ingestion permissions</li>
                        <li>Verify you're sending to <code>/api/v1/otlp/logs</code></li>
                        <li>Both <code>application/json</code> and <code>application/x-protobuf</code> are supported</li>
                        <li>Check rate limits (default: 200 req/min per API key)</li>
                    </ul>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="text-base flex items-center gap-2">
                        <AlertCircle class="w-4 h-4 text-yellow-500" />
                        Empty logs appearing
                    </CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    Ensure your log records have a <code>body</code> field with content.
                    The <code>body.stringValue</code> is used as the message.
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="text-base flex items-center gap-2">
                        <AlertCircle class="w-4 h-4 text-yellow-500" />
                        Service name showing as "unknown"
                    </CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    Set the <code>service.name</code> resource attribute in your SDK configuration.
                </CardContent>
            </Card>
        </div>

        <h3 id="debug-logging" class="text-lg font-semibold mt-6 mb-3 scroll-mt-20">Enable Debug Logging</h3>

        <p class="mb-4 text-sm text-muted-foreground">
            Enable debug logging to troubleshoot ingestion issues:
        </p>

        <CodeBlock
            lang="bash"
            code={`# LogWard Backend - Enable OTLP debug logging
# Shows raw protobuf structure for debugging parsing issues
OTLP_DEBUG=true

# OpenTelemetry SDK - Node.js
export OTEL_LOG_LEVEL=debug

# OpenTelemetry SDK - Python
import logging
logging.basicConfig(level=logging.DEBUG)`}
        />

        <p class="mt-4 text-sm text-muted-foreground">
            When <code>OTLP_DEBUG=true</code> is set on the LogWard backend,
            it will log the raw protobuf structure of incoming log records,
            which helps diagnose parsing or field mapping issues.
        </p>
    </div>

    <h2
        id="migration"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Migration from Custom SDKs
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            If you're currently using LogWard's custom SDKs, you can migrate to
            OpenTelemetry for standardized instrumentation:
        </p>

        <div class="grid md:grid-cols-2 gap-4 mb-6">
            <Card>
                <CardHeader>
                    <CardTitle class="text-base">Custom SDK</CardTitle>
                </CardHeader>
                <CardContent>
                    <CodeBlock
                        lang="typescript"
                        code={`import { LogWardClient } from '@logward-dev/sdk-node';

const client = new LogWardClient({
  apiKey: 'your-key'
});

client.info('api', 'User logged in', {
  userId: '123'
});`}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="text-base">OpenTelemetry</CardTitle>
                </CardHeader>
                <CardContent>
                    <CodeBlock
                        lang="typescript"
                        code={`import { logs, SeverityNumber } from '@opentelemetry/api-logs';

const logger = logs.getLogger('my-logger');

logger.emit({
  severityNumber: SeverityNumber.INFO,
  body: 'User logged in',
  attributes: { 'user.id': '123' },
});`}
                    />
                </CardContent>
            </Card>
        </div>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">Benefits of OpenTelemetry</CardTitle>
            </CardHeader>
            <CardContent class="text-sm">
                <ul class="space-y-2">
                    <li class="flex items-center gap-2">
                        <Check class="w-4 h-4 text-green-500" />
                        <span><strong>Vendor-neutral:</strong> Switch backends without code changes</span>
                    </li>
                    <li class="flex items-center gap-2">
                        <Check class="w-4 h-4 text-green-500" />
                        <span><strong>Auto-instrumentation:</strong> Automatic logging for popular frameworks</span>
                    </li>
                    <li class="flex items-center gap-2">
                        <Check class="w-4 h-4 text-green-500" />
                        <span><strong>Trace correlation:</strong> Built-in distributed tracing support</span>
                    </li>
                    <li class="flex items-center gap-2">
                        <Check class="w-4 h-4 text-green-500" />
                        <span><strong>Large ecosystem:</strong> Extensive integrations and community support</span>
                    </li>
                </ul>
            </CardContent>
        </Card>
    </div>
</div>

<style>
    .docs-content :global(code:not(pre code)) {
        @apply px-1.5 py-0.5 bg-muted rounded text-sm font-mono;
    }
</style>
