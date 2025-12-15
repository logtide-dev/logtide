<script lang="ts">
    import Breadcrumbs from "$lib/components/docs/Breadcrumbs.svelte";
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
</script>

<div class="docs-content">
    <Breadcrumbs />

    <h1 class="text-3xl font-bold mb-4">Architecture</h1>
    <p class="text-lg text-muted-foreground mb-8">
        Understanding LogWard's system architecture and design decisions.
    </p>

    <h2
        id="overview"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        System Overview
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            LogWard follows a modern microservices architecture with clear
            separation of concerns:
        </p>

        <Card class="mb-6">
            <CardHeader>
                <CardTitle>Data Hierarchy</CardTitle>
            </CardHeader>
            <CardContent>
                <pre class="text-sm bg-muted p-4 rounded-md overflow-x-auto">
User → Organizations (1:N) → Projects (1:N) → API Keys → Logs
        </pre>
            </CardContent>
        </Card>

        <ul class="space-y-3 ml-6">
            <li>
                <strong>Organizations</strong> - Top-level isolation for companies/teams.
                Each user can belong to multiple organizations.
            </li>
            <li>
                <strong>Projects</strong> - Logical grouping within organizations
                (e.g., "production", "staging"). Complete data isolation.
            </li>
            <li>
                <strong>API Keys</strong> - Project-scoped keys for secure log
                ingestion and query. Prefixed with <code>lp_</code>.
            </li>
            <li>
                <strong>Logs</strong> - Time-series data stored in TimescaleDB with
                automatic compression and retention policies.
            </li>
        </ul>
    </div>

    <h2
        id="tech-stack"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Technology Stack
    </h2>

    <div class="mb-8 grid md:grid-cols-2 gap-6">
        <Card>
            <CardHeader>
                <CardTitle class="text-base">Backend</CardTitle>
            </CardHeader>
            <CardContent class="text-sm space-y-1">
                <p><strong>Runtime:</strong> Node.js 20+</p>
                <p><strong>Framework:</strong> Fastify</p>
                <p><strong>Language:</strong> TypeScript 5</p>
                <p><strong>ORM:</strong> Kysely (type-safe SQL)</p>
                <p><strong>Queue:</strong> BullMQ + Redis</p>
                <p><strong>Validation:</strong> Zod schemas</p>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">Frontend</CardTitle>
            </CardHeader>
            <CardContent class="text-sm space-y-1">
                <p><strong>Framework:</strong> SvelteKit 5 (Runes)</p>
                <p><strong>Language:</strong> TypeScript 5</p>
                <p><strong>Styling:</strong> TailwindCSS</p>
                <p><strong>Components:</strong> shadcn-svelte</p>
                <p><strong>Charts:</strong> ECharts</p>
                <p><strong>State:</strong> Svelte stores</p>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">Database</CardTitle>
            </CardHeader>
            <CardContent class="text-sm space-y-1">
                <p><strong>RDBMS:</strong> PostgreSQL 16</p>
                <p><strong>Extension:</strong> TimescaleDB</p>
                <p><strong>Time-series:</strong> Hypertables</p>
                <p><strong>Compression:</strong> Automatic</p>
                <p><strong>Retention:</strong> Configurable policies</p>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">Infrastructure</CardTitle>
            </CardHeader>
            <CardContent class="text-sm space-y-1">
                <p><strong>Cache:</strong> Redis 7</p>
                <p><strong>Proxy:</strong> Nginx</p>
                <p><strong>Container:</strong> Docker</p>
                <p><strong>Orchestration:</strong> Docker Compose</p>
                <p><strong>Monorepo:</strong> pnpm workspaces</p>
            </CardContent>
        </Card>
    </div>

    <h2
        id="components"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Core Components
    </h2>

    <div class="mb-8 space-y-6">
        <div>
            <h3 id="backend-server" class="text-lg font-semibold mb-2 scroll-mt-20">Backend Server (Fastify)</h3>
            <p class="text-muted-foreground mb-3">
                High-performance API server handling log ingestion, query, and
                management endpoints. Modular architecture with feature-based
                modules:
            </p>
            <ul class="ml-6 space-y-1 text-sm text-muted-foreground">
                <li><code>auth/</code> - Authentication and user management</li>
                <li>
                    <code>ingestion/</code> - Log ingestion with batch support
                </li>
                <li><code>query/</code> - Log search and filtering</li>
                <li><code>alerts/</code> - Alert rule management</li>
                <li><code>dashboard/</code> - Statistics and aggregations</li>
            </ul>
        </div>

        <div>
            <h3 id="worker-process" class="text-lg font-semibold mb-2 scroll-mt-20">Worker Process (BullMQ)</h3>
            <p class="text-muted-foreground">
                Background job processor for alert evaluation, notifications,
                and data retention. Runs independently from the main API server.
            </p>
        </div>

        <div>
            <h3 id="frontend-dashboard" class="text-lg font-semibold mb-2 scroll-mt-20">
                Frontend Dashboard (SvelteKit)
            </h3>
            <p class="text-muted-foreground">
                Modern, reactive UI with real-time log streaming, search, alerts
                management, and organization administration. Server-side
                rendering for optimal performance.
            </p>
        </div>

        <div>
            <h3 id="timescaledb" class="text-lg font-semibold mb-2 scroll-mt-20">TimescaleDB</h3>
            <p class="text-muted-foreground">
                PostgreSQL extension optimized for time-series data. Automatic
                partitioning, compression, and retention policies for efficient
                long-term log storage.
            </p>
        </div>
    </div>

    <h2
        id="data-flow"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Data Flow
    </h2>

    <div class="mb-8">
        <h3 id="log-ingestion-flow" class="text-lg font-semibold mb-3 scroll-mt-20">Log Ingestion Flow</h3>
        <ol class="ml-6 space-y-2 text-muted-foreground">
            <li>
                1. Client sends logs via <code>POST /api/v1/ingest</code> with API
                key
            </li>
            <li>2. Backend validates API key and extracts project ID</li>
            <li>3. Logs are validated against Zod schema</li>
            <li>4. Batch insert into TimescaleDB hypertable</li>
            <li>5. Alert evaluator job is triggered (BullMQ)</li>
            <li>6. Logs are broadcast to active SSE streams</li>
        </ol>

        <h3 id="alert-processing-flow" class="text-lg font-semibold mb-3 mt-6 scroll-mt-20">Alert Processing Flow</h3>
        <ol class="ml-6 space-y-2 text-muted-foreground">
            <li>1. Worker evaluates all enabled alert rules (every minute)</li>
            <li>2. For each rule, query logs matching conditions</li>
            <li>3. If threshold exceeded, create alert instance</li>
            <li>
                4. Send notifications (email/webhook) via configured channels
            </li>
            <li>5. Update alert status and last triggered timestamp</li>
        </ol>
    </div>

    <h2
        id="design-decisions"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Key Design Decisions
    </h2>

    <div class="space-y-4">
        <Card>
            <CardHeader>
                <CardTitle class="text-base">Why TimescaleDB?</CardTitle>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Native time-series optimizations, automatic compression,
                built-in retention policies, and PostgreSQL compatibility make
                it ideal for log storage with high ingestion rates.
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">Why Fastify?</CardTitle>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Excellent performance, native TypeScript support, schema
                validation, plugin ecosystem, and lower overhead compared to
                Express make it perfect for high-throughput log ingestion.
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">Why SvelteKit 5?</CardTitle>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Modern reactivity with Runes, excellent performance, built-in
                SSR, file-based routing, and minimal bundle size provide the
                best developer and user experience.
            </CardContent>
        </Card>
    </div>
</div>

<style>
    .docs-content :global(code:not(pre code)) {
        @apply px-1.5 py-0.5 bg-muted rounded text-sm font-mono;
    }
</style>
