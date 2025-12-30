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
    import { Check, X, AlertCircle, Clock, ArrowRight, Bell, Search } from "lucide-svelte";
</script>

<div class="docs-content">
    <Breadcrumbs />

    <div class="flex items-center justify-between mb-4">
        <h1 class="text-3xl font-bold">Migrate from Grafana Loki</h1>
        <div class="flex items-center gap-2">
            <Badge variant="outline" class="bg-green-500/10 text-green-600 border-green-500/20">
                Easy
            </Badge>
            <Badge variant="secondary">
                <Clock class="w-3 h-3 mr-1" />
                4-6 hours
            </Badge>
        </div>
    </div>

    <p class="text-lg text-muted-foreground mb-8">
        Migrate from Grafana Loki to LogWard for built-in alerting, SIEM capabilities,
        and richer full-text search without needing separate tools for visualization and alerting.
    </p>

    <h2
        id="why-migrate"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Why Migrate from Loki?
    </h2>

    <div class="mb-8 grid md:grid-cols-2 gap-4">
        <Card>
            <CardContent class="pt-4">
                <div class="flex items-start gap-3">
                    <Bell class="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                        <h3 class="font-semibold mb-1">Built-in Alerting</h3>
                        <p class="text-sm text-muted-foreground">
                            Loki requires Prometheus AlertManager or Grafana Alerting for alerts.
                            LogWard has native alert rules with email/webhook support.
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardContent class="pt-4">
                <div class="flex items-start gap-3">
                    <Search class="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                        <h3 class="font-semibold mb-1">True Full-text Search</h3>
                        <p class="text-sm text-muted-foreground">
                            Loki uses label-based indexing with limited search.
                            LogWard indexes log content for fast full-text search.
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardContent class="pt-4">
                <div class="flex items-start gap-3">
                    <Check class="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                        <h3 class="font-semibold mb-1">All-in-One Solution</h3>
                        <p class="text-sm text-muted-foreground">
                            No need for Grafana, Prometheus, or AlertManager.
                            LogWard includes UI, alerting, and SIEM in one package.
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardContent class="pt-4">
                <div class="flex items-start gap-3">
                    <Check class="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                        <h3 class="font-semibold mb-1">Security Detection</h3>
                        <p class="text-sm text-muted-foreground">
                            Loki is pure log aggregation. LogWard includes Sigma rules,
                            incident management, and MITRE ATT&CK mapping.
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>
    </div>

    <h2
        id="feature-comparison"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Feature Comparison
    </h2>

    <div class="mb-8 overflow-x-auto">
        <table class="w-full text-sm border border-border rounded-lg">
            <thead class="bg-muted">
                <tr>
                    <th class="px-4 py-3 text-left border-b border-border">Feature</th>
                    <th class="px-4 py-3 text-left border-b border-border">Grafana Loki</th>
                    <th class="px-4 py-3 text-left border-b border-border">LogWard</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="px-4 py-3 border-b border-border font-medium">Log Ingestion</td>
                    <td class="px-4 py-3 border-b border-border"><Check class="w-4 h-4 text-green-500 inline" /> Promtail, Fluent Bit</td>
                    <td class="px-4 py-3 border-b border-border"><Check class="w-4 h-4 text-green-500 inline" /> HTTP API, SDKs, OTLP</td>
                </tr>
                <tr>
                    <td class="px-4 py-3 border-b border-border font-medium">Query Language</td>
                    <td class="px-4 py-3 border-b border-border">LogQL</td>
                    <td class="px-4 py-3 border-b border-border">REST API + Full-text</td>
                </tr>
                <tr>
                    <td class="px-4 py-3 border-b border-border font-medium">Full-text Search</td>
                    <td class="px-4 py-3 border-b border-border"><span class="text-yellow-600">Limited</span> (regex only)</td>
                    <td class="px-4 py-3 border-b border-border"><Check class="w-4 h-4 text-green-500 inline" /> Indexed</td>
                </tr>
                <tr>
                    <td class="px-4 py-3 border-b border-border font-medium">Indexing Strategy</td>
                    <td class="px-4 py-3 border-b border-border">Labels only</td>
                    <td class="px-4 py-3 border-b border-border">Labels + Content</td>
                </tr>
                <tr>
                    <td class="px-4 py-3 border-b border-border font-medium">Built-in Alerting</td>
                    <td class="px-4 py-3 border-b border-border"><X class="w-4 h-4 text-red-500 inline" /> Requires Grafana</td>
                    <td class="px-4 py-3 border-b border-border"><Check class="w-4 h-4 text-green-500 inline" /> Native</td>
                </tr>
                <tr>
                    <td class="px-4 py-3 border-b border-border font-medium">Built-in UI</td>
                    <td class="px-4 py-3 border-b border-border"><X class="w-4 h-4 text-red-500 inline" /> Requires Grafana</td>
                    <td class="px-4 py-3 border-b border-border"><Check class="w-4 h-4 text-green-500 inline" /> Included</td>
                </tr>
                <tr>
                    <td class="px-4 py-3 border-b border-border font-medium">Sigma Rules</td>
                    <td class="px-4 py-3 border-b border-border"><X class="w-4 h-4 text-red-500 inline" /> No</td>
                    <td class="px-4 py-3 border-b border-border"><Check class="w-4 h-4 text-green-500 inline" /> Built-in</td>
                </tr>
                <tr>
                    <td class="px-4 py-3 border-b border-border font-medium">Incident Management</td>
                    <td class="px-4 py-3 border-b border-border"><X class="w-4 h-4 text-red-500 inline" /> No</td>
                    <td class="px-4 py-3 border-b border-border"><Check class="w-4 h-4 text-green-500 inline" /> Built-in</td>
                </tr>
                <tr>
                    <td class="px-4 py-3 border-b border-border font-medium">OpenTelemetry</td>
                    <td class="px-4 py-3 border-b border-border"><Check class="w-4 h-4 text-green-500 inline" /> Yes</td>
                    <td class="px-4 py-3 border-b border-border"><Check class="w-4 h-4 text-green-500 inline" /> Native OTLP</td>
                </tr>
                <tr>
                    <td class="px-4 py-3 border-b border-border font-medium">Real-time Streaming</td>
                    <td class="px-4 py-3 border-b border-border"><Check class="w-4 h-4 text-green-500 inline" /> Tail queries</td>
                    <td class="px-4 py-3 border-b border-border"><Check class="w-4 h-4 text-green-500 inline" /> SSE</td>
                </tr>
                <tr>
                    <td class="px-4 py-3 font-medium">Pricing</td>
                    <td class="px-4 py-3">Open-source</td>
                    <td class="px-4 py-3"><span class="text-green-600 font-medium">Open-source</span></td>
                </tr>
            </tbody>
        </table>
    </div>

    <h2
        id="step-1"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Step 1: Deploy LogWard
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            See the <a href="/docs/deployment" class="text-primary hover:underline">Deployment Guide</a> for full instructions:
        </p>

        <CodeBlock
            lang="bash"
            code={`# Clone LogWard
git clone https://github.com/logward-dev/logward.git
cd logward/docker

# Configure
cp .env.example .env
# Edit .env with your settings

# Start
docker compose up -d

# Verify
curl http://localhost:8080/health`}
        />

        <p class="mt-4">
            Create your organization and project via the UI, then generate an API key.
        </p>
    </div>

    <h2
        id="step-2"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Step 2: Replace Promtail with Fluent Bit
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            Promtail is Loki's log shipper. Replace it with Fluent Bit to send logs to LogWard:
        </p>

        <div class="grid md:grid-cols-2 gap-4 mb-6">
            <Card>
                <CardHeader class="pb-2">
                    <CardTitle class="text-base">Before (Promtail)</CardTitle>
                </CardHeader>
                <CardContent>
                    <CodeBlock
                        lang="yaml"
                        code={`# promtail-config.yaml
server:
  http_listen_port: 9080

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: app
    static_configs:
      - targets:
          - localhost
        labels:
          job: app
          __path__: /var/log/app/*.log`}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader class="pb-2">
                    <CardTitle class="text-base">After (Fluent Bit)</CardTitle>
                </CardHeader>
                <CardContent>
                    <CodeBlock
                        lang="ini"
                        code={`# fluent-bit.conf
[SERVICE]
    Flush        1
    Log_Level    info

[INPUT]
    Name         tail
    Path         /var/log/app/*.log
    Tag          app

[OUTPUT]
    Name         http
    Match        *
    Host         logward.internal
    Port         8080
    URI          /api/v1/ingest
    Format       json
    Header       X-API-Key lp_xxx`}
                    />
                </CardContent>
            </Card>
        </div>

        <h3 class="text-lg font-semibold mb-3">Docker Compose Example</h3>

        <CodeBlock
            lang="yaml"
            code={`# docker-compose.yml
services:
  fluent-bit:
    image: fluent/fluent-bit:4.2.2  # For ARM64: cr.fluentbit.io/fluent/fluent-bit:4.2.2
    volumes:
      - ./fluent-bit.conf:/fluent-bit/etc/fluent-bit.conf
      - /var/log:/var/log:ro
    environment:
      - LOGWARD_API_KEY=lp_your_api_key
    depends_on:
      - logward`}
        />
    </div>

    <h2
        id="step-3"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Step 3: Query Migration (LogQL to LogWard)
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            LogQL queries translate to LogWard REST API parameters:
        </p>

        <div class="overflow-x-auto mb-6">
            <table class="w-full text-sm border border-border rounded-lg">
                <thead class="bg-muted">
                    <tr>
                        <th class="px-4 py-2 text-left border-b border-border">LogQL</th>
                        <th class="px-4 py-2 text-left border-b border-border">LogWard API</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs"><code>{'{job="api"}'}</code></td>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">GET /api/v1/logs?service=api</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs"><code>{'{job="api"} |= "error"'}</code></td>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">GET /api/v1/logs?service=api&level=error</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs"><code>{'{job="api"} |~ "timeout|connection"'}</code></td>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">GET /api/v1/logs?service=api&q=timeout</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs"><code>{'{job="api"} | json'}</code></td>
                        <td class="px-4 py-2 border-b border-border font-mono text-xs">Auto (metadata is JSON)</td>
                    </tr>
                    <tr>
                        <td class="px-4 py-2 font-mono text-xs"><code>{'count_over_time({job="api"}[5m])'}</code></td>
                        <td class="px-4 py-2 font-mono text-xs">GET /api/v1/logs/aggregated?interval=5m</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <Card>
            <CardContent class="pt-4">
                <h3 class="font-semibold mb-2">Key Difference: Full-text Search</h3>
                <p class="text-sm text-muted-foreground">
                    Loki requires regex patterns (<code>|~</code>) to search log content because
                    it doesn't index log bodies. LogWard indexes everything, so you can search
                    any text with the <code>q</code> parameter without regex overhead.
                </p>
            </CardContent>
        </Card>
    </div>

    <h2
        id="step-4"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Step 4: Create Alert Rules
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            Loki alerting requires Grafana or Prometheus AlertManager. LogWard has native alerts:
        </p>

        <div class="grid md:grid-cols-2 gap-4">
            <Card>
                <CardHeader class="pb-2">
                    <CardTitle class="text-base">Loki (via Grafana)</CardTitle>
                </CardHeader>
                <CardContent>
                    <CodeBlock
                        lang="yaml"
                        code={`# Grafana alert rule
groups:
  - name: app-alerts
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate({job="api"}
            |= "error" [5m])) > 10
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: High error rate`}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader class="pb-2">
                    <CardTitle class="text-base">LogWard Alert Rule</CardTitle>
                </CardHeader>
                <CardContent>
                    <CodeBlock
                        lang="json"
                        code={`{
  "name": "High Error Rate",
  "enabled": true,
  "service": "api",
  "level": ["error"],
  "threshold": 50,
  "timeWindow": 5,
  "emailRecipients": [
    "team@example.com"
  ],
  "webhookUrl": "https://hooks.slack.com/..."
}`}
                    />
                </CardContent>
            </Card>
        </div>

        <p class="mt-4">
            Create alerts via the LogWard UI at <code>/dashboard/alerts</code> or via the API.
        </p>
    </div>

    <h2
        id="step-5"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Step 5: Enable SIEM Features
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            LogWard includes SIEM capabilities that Loki doesn't have:
        </p>

        <Card class="mb-4">
            <CardContent class="pt-4">
                <h3 class="font-semibold mb-3">Security Features in LogWard</h3>
                <ul class="space-y-2 text-sm">
                    <li class="flex items-center gap-2">
                        <Check class="w-4 h-4 text-green-500" />
                        <span><strong>Sigma Rules:</strong> Import threat detection rules from SigmaHQ</span>
                    </li>
                    <li class="flex items-center gap-2">
                        <Check class="w-4 h-4 text-green-500" />
                        <span><strong>Incident Management:</strong> Track, assign, and resolve security incidents</span>
                    </li>
                    <li class="flex items-center gap-2">
                        <Check class="w-4 h-4 text-green-500" />
                        <span><strong>MITRE ATT&CK:</strong> Map detections to attack techniques</span>
                    </li>
                    <li class="flex items-center gap-2">
                        <Check class="w-4 h-4 text-green-500" />
                        <span><strong>SIEM Dashboard:</strong> Security-focused visualizations</span>
                    </li>
                </ul>
            </CardContent>
        </Card>

        <p class="mb-4">
            Access the SIEM dashboard at <code>/dashboard/security</code>.
        </p>
    </div>

    <h2
        id="concept-mapping"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Concept Mapping
    </h2>

    <div class="mb-8 overflow-x-auto">
        <table class="w-full text-sm border border-border rounded-lg">
            <thead class="bg-muted">
                <tr>
                    <th class="px-4 py-2 text-left border-b border-border">Loki Term</th>
                    <th class="px-4 py-2 text-left border-b border-border">LogWard Equivalent</th>
                    <th class="px-4 py-2 text-left border-b border-border">Notes</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="px-4 py-2 border-b border-border">Tenant</td>
                    <td class="px-4 py-2 border-b border-border">Organization / Project</td>
                    <td class="px-4 py-2 border-b border-border">Multi-tenancy via projects</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 border-b border-border">Labels</td>
                    <td class="px-4 py-2 border-b border-border">service + metadata</td>
                    <td class="px-4 py-2 border-b border-border">service is indexed, extra fields in metadata</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 border-b border-border">Stream</td>
                    <td class="px-4 py-2 border-b border-border">Service</td>
                    <td class="px-4 py-2 border-b border-border">One label set = one service</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 border-b border-border">Promtail</td>
                    <td class="px-4 py-2 border-b border-border">Fluent Bit / SDK</td>
                    <td class="px-4 py-2 border-b border-border">Use Fluent Bit or application SDK</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 border-b border-border">LogQL</td>
                    <td class="px-4 py-2 border-b border-border">REST API params</td>
                    <td class="px-4 py-2 border-b border-border">Simpler query syntax</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 border-b border-border">Grafana</td>
                    <td class="px-4 py-2 border-b border-border">LogWard UI</td>
                    <td class="px-4 py-2 border-b border-border">Built-in web interface</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 border-b border-border">Grafana Alerting</td>
                    <td class="px-4 py-2 border-b border-border">Alert Rules</td>
                    <td class="px-4 py-2 border-b border-border">Native alerting, no external tools</td>
                </tr>
                <tr>
                    <td class="px-4 py-2">N/A</td>
                    <td class="px-4 py-2">Sigma Rules + SIEM</td>
                    <td class="px-4 py-2">LogWard exclusive</td>
                </tr>
            </tbody>
        </table>
    </div>

    <h2
        id="troubleshooting"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Common Issues
    </h2>

    <div class="mb-8 space-y-4">
        <Card>
            <CardHeader>
                <CardTitle class="text-base flex items-center gap-2">
                    <AlertCircle class="w-4 h-4 text-yellow-500" />
                    High cardinality labels
                </CardTitle>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Loki has strict label cardinality limits. LogWard is more flexible -
                use the <code>service</code> field for core identity and put variable
                data in <code>metadata</code> JSON (not indexed, no cardinality issues).
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base flex items-center gap-2">
                    <AlertCircle class="w-4 h-4 text-yellow-500" />
                    Missing Grafana dashboards
                </CardTitle>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                LogWard doesn't have Grafana-style custom dashboards yet.
                Use the SIEM dashboard for security metrics. For custom visualizations,
                you can query the LogWard API from external tools.
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base flex items-center gap-2">
                    <AlertCircle class="w-4 h-4 text-yellow-500" />
                    Log parsing differences
                </CardTitle>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Loki uses pipeline stages (<code>| json</code>, <code>| logfmt</code>).
                LogWard expects JSON logs - structure your logs in your application
                or use Fluent Bit parsers before sending.
            </CardContent>
        </Card>
    </div>

    <h2
        id="next-steps"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Next Steps
    </h2>

    <div class="mb-8">
        <div class="grid gap-3">
            <a href="/docs/api" class="block">
                <Card class="transition-all hover:border-primary/50">
                    <CardContent class="pt-4 flex items-center justify-between">
                        <span class="font-medium">API Reference</span>
                        <ArrowRight class="w-4 h-4" />
                    </CardContent>
                </Card>
            </a>
            <a href="/docs/opentelemetry" class="block">
                <Card class="transition-all hover:border-primary/50">
                    <CardContent class="pt-4 flex items-center justify-between">
                        <span class="font-medium">OpenTelemetry Integration</span>
                        <ArrowRight class="w-4 h-4" />
                    </CardContent>
                </Card>
            </a>
            <a href="/docs/sdks" class="block">
                <Card class="transition-all hover:border-primary/50">
                    <CardContent class="pt-4 flex items-center justify-between">
                        <span class="font-medium">SDK Documentation</span>
                        <ArrowRight class="w-4 h-4" />
                    </CardContent>
                </Card>
            </a>
        </div>
    </div>
</div>

<style>
    .docs-content :global(code:not(pre code)) {
        @apply px-1.5 py-0.5 bg-muted rounded text-sm font-mono;
    }
</style>
