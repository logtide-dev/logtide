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
    import { ExternalLink } from "lucide-svelte";
</script>

<div class="docs-content">
    <Breadcrumbs />

    <div class="flex items-center justify-between mb-4">
        <h1 class="text-3xl font-bold">Node.js SDK</h1>
        <a
            href="https://github.com/logward-dev/logward-sdk-node"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
            <ExternalLink class="w-4 h-4" />
            GitHub
        </a>
    </div>

    <p class="text-lg text-muted-foreground mb-8">
        Official Node.js SDK for LogWard with full TypeScript support, automatic
        batching, retry logic, and Express/Fastify middleware.
    </p>

    <h2
        id="installation"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Installation
    </h2>

    <div class="mb-8">
        <CodeBlock
            lang="bash"
            code={`npm install @logward-dev/sdk-node

# or with pnpm
pnpm add @logward-dev/sdk-node

# or with yarn
yarn add @logward-dev/sdk-node`}
        />
    </div>

    <h2
        id="quick-start"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Quick Start
    </h2>

    <div class="mb-8">
        <CodeBlock
            lang="typescript"
            code={`import { LogWardClient } from '@logward-dev/sdk-node';

const client = new LogWardClient({
  apiUrl: 'http://localhost:8080',
  apiKey: 'lp_your_api_key_here',
});

// Send logs
client.info('api-gateway', 'Server started', { port: 3000 });
client.error('database', 'Connection failed', new Error('Timeout'));

// Graceful shutdown
process.on('SIGINT', async () => {
  await client.close();
  process.exit(0);
});`}
        />
    </div>

    <h2
        id="features"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Features
    </h2>

    <div class="mb-8 grid gap-3">
        <Card>
            <CardContent class="pt-4 text-sm">
                <ul class="space-y-2">
                    <li>
                        ✅ Automatic batching with configurable size and
                        interval
                    </li>
                    <li>✅ Retry logic with exponential backoff</li>
                    <li>✅ Circuit breaker pattern for fault tolerance</li>
                    <li>
                        ✅ Max buffer size with drop policy to prevent memory
                        leaks
                    </li>
                    <li>✅ Query API for searching and filtering logs</li>
                    <li>✅ Live tail with Server-Sent Events (SSE)</li>
                    <li>✅ Trace ID context for distributed tracing</li>
                    <li>✅ Global metadata added to all logs</li>
                    <li>✅ Structured error serialization</li>
                    <li>✅ Internal metrics (logs sent, errors, latency)</li>
                    <li>
                        ✅ Express & Fastify middleware for auto-logging HTTP
                        requests
                    </li>
                    <li>✅ Full TypeScript support with strict types</li>
                </ul>
            </CardContent>
        </Card>
    </div>

    <h2
        id="configuration"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Configuration
    </h2>

    <div class="mb-8">
        <CodeBlock
            lang="typescript"
            code={`const client = new LogWardClient({
  // Required
  apiUrl: 'http://localhost:8080',
  apiKey: 'lp_your_api_key',
  
  // Optional - Performance
  batchSize: 100,              // Max logs per batch (default: 100)
  batchInterval: 5000,         // Flush interval in ms (default: 5000)
  maxBufferSize: 10000,        // Max logs in buffer (default: 10000)
  
  // Optional - Reliability
  maxRetries: 3,               // Max retry attempts (default: 3)
  retryDelay: 1000,            // Initial retry delay in ms (default: 1000)
  circuitBreakerThreshold: 5,  // Failures before circuit opens (default: 5)
  circuitBreakerTimeout: 60000, // Circuit reset timeout in ms (default: 60000)
  
  // Optional - Metadata
  globalMetadata: {            // Added to all logs
    environment: 'production',
    version: '1.0.0'
  },
  
  // Optional - Debug
  debug: false                 // Enable debug logging (default: false)
});`}
        />
    </div>

    <h2
        id="logging"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Logging Methods
    </h2>

    <div class="mb-8 space-y-6">
        <div>
            <h3 id="basic-logging" class="text-lg font-semibold mb-3 scroll-mt-20">Basic Logging</h3>
            <CodeBlock
                lang="typescript"
                code={`// Log levels: debug, info, warn, error, critical
client.debug('service-name', 'Debug message', { detail: 'value' });
client.info('api-gateway', 'Request received', { method: 'GET', path: '/users' });
client.warn('cache', 'Cache miss', { key: 'user:123' });
client.error('database', 'Query failed', { query: 'SELECT *' });
client.critical('system', 'Out of memory', { used: '95%' });`}
            />
        </div>

        <div>
            <h3 id="error-logging" class="text-lg font-semibold mb-3 scroll-mt-20">
                Error Logging with Auto-Serialization
            </h3>
            <CodeBlock
                lang="typescript"
                code={`try {
  await riskyOperation();
} catch (error) {
  // Error is automatically serialized (stack trace, message, etc.)
  client.error('api', 'Operation failed', error);
}`}
            />
        </div>
    </div>

    <h2
        id="middleware"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Middleware Integration
    </h2>

    <div class="mb-8 space-y-6">
        <div>
            <h3 id="express-middleware" class="text-lg font-semibold mb-3 scroll-mt-20">Express Middleware</h3>
            <CodeBlock
                lang="typescript"
                code={`import express from 'express';
import { createExpressMiddleware } from '@logward-dev/sdk-node';

const app = express();

// Add LogWard middleware
app.use(createExpressMiddleware(client, {
  includeHeaders: true,       // Log request headers
  includeBody: false,         // Log request body (be careful with sensitive data)
  includeResponseTime: true   // Log response time
}));

app.get('/users', (req, res) => {
  // Your route logic
  res.json({ users: [] });
});

// Logs will be automatically sent for each request`}
            />
        </div>

        <div>
            <h3 id="fastify-plugin" class="text-lg font-semibold mb-3 scroll-mt-20">Fastify Plugin</h3>
            <CodeBlock
                lang="typescript"
                code={`import Fastify from 'fastify';
import { fastifyLogWardPlugin } from '@logward-dev/sdk-node';

const fastify = Fastify();

// Register LogWard plugin
await fastify.register(fastifyLogWardPlugin, {
  client,
  includeHeaders: true,
  includeResponseTime: true
});

fastify.get('/users', async (request, reply) => {
  // Your route logic
  return { users: [] };
});

// Logs automatically sent for each request`}
            />
        </div>
    </div>

    <h2
        id="query-api"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Query API
    </h2>

    <div class="mb-8">
        <CodeBlock
            lang="typescript"
            code={`// Search logs
const logs = await client.query({
  service: 'api-gateway',
  level: 'error',
  from: '2025-01-15T00:00:00Z',
  to: '2025-01-15T23:59:59Z',
  q: 'timeout',  // Full-text search
  limit: 100
});

console.log(\`Found \${logs.total} error logs\`);
logs.logs.forEach(log => {
  console.log(\`[\${log.time}] \${log.message}\`);
});`}
        />
    </div>

    <h2
        id="live-tail"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Live Tail (Streaming)
    </h2>

    <div class="mb-8">
        <CodeBlock
            lang="typescript"
            code={`// Stream logs in real-time
const stream = client.stream({
  service: 'api-gateway',
  level: 'error'
});

stream.on('log', (log) => {
  console.log('New log:', log);
});

stream.on('error', (error) => {
  console.error('Stream error:', error);
});

// Stop streaming
setTimeout(() => {
  stream.close();
}, 60000);`}
        />
    </div>

    <h2
        id="best-practices"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Best Practices
    </h2>

    <div class="space-y-4">
        <Card>
            <CardHeader>
                <CardTitle class="text-base"
                    >1. Always Close on Shutdown</CardTitle
                >
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Ensure logs are flushed before your application exits by calling <code
                    >await client.close()</code
                > in shutdown handlers.
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">2. Use Global Metadata</CardTitle>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Add environment, version, and other common fields as global
                metadata instead of repeating them in every log.
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base"
                    >3. Enable Debug Mode in Development</CardTitle
                >
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Set <code>debug: true</code> during development to see SDK internal
                logs and troubleshoot issues.
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base"
                    >4. Use Trace IDs for Request Correlation</CardTitle
                >
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Leverage trace IDs to correlate logs across distributed services
                for better debugging.
            </CardContent>
        </Card>
    </div>
</div>

<style>
    .docs-content :global(code:not(pre code)) {
        @apply px-1.5 py-0.5 bg-muted rounded text-sm font-mono;
    }
</style>
