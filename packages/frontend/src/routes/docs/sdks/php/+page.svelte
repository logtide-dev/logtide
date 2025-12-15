<script lang="ts">
    import Breadcrumbs from "$lib/components/docs/Breadcrumbs.svelte";
    import CodeBlock from "$lib/components/docs/CodeBlock.svelte";
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { ExternalLink } from "lucide-svelte";
</script>

<div class="docs-content">
    <Breadcrumbs />

    <div class="flex items-center justify-between mb-4">
        <h1 class="text-3xl font-bold">PHP SDK</h1>
        <a
            href="https://github.com/logward-dev/logward-sdk-php"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
            <ExternalLink class="w-4 h-4" />
            GitHub
        </a>
    </div>

    <p class="text-lg text-muted-foreground mb-8">
        Official PHP SDK for LogWard with strict types, automatic batching,
        retry logic, and Laravel/Symfony/PSR-15 middleware.
    </p>

    <h2
        id="installation"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Installation
    </h2>

    <div class="mb-8">
        <p class="mb-3 text-muted-foreground">Requires PHP 8.1 or higher</p>
        <CodeBlock lang="bash" code={`composer require logward/sdk-php`} />
    </div>

    <h2
        id="quick-start"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Quick Start
    </h2>

    <div class="mb-8">
        <CodeBlock
            lang="php"
            code={`<?php

use LogWard\\SDK\\LogWardClient;
use LogWard\\SDK\\Models\\LogWardClientOptions;

$client = new LogWardClient(new LogWardClientOptions(
    apiUrl: 'http://localhost:8080',
    apiKey: 'lp_your_api_key_here',
));

// Send logs
$client->info('api-gateway', 'Server started', ['port' => 3000]);
$client->error('database', 'Connection failed', new PDOException('Timeout'));

// Shutdown is auto-handled via register_shutdown_function`}
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
                    <li>✅ Laravel, Symfony & PSR-15 middleware</li>
                    <li>
                        ✅ Full PHP 8.1+ support with strict types and enums
                    </li>
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
            lang="php"
            code={`<?php

$client = new LogWardClient(new LogWardClientOptions(
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
    globalMetadata: [            // Added to all logs
        'environment' => 'production',
        'version' => '1.0.0'
    ],
    
    // Optional - Debug
    debug: false                 // Enable debug logging (default: false)
));`}
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
                lang="php"
                code={`<?php

// Log levels: debug, info, warn, error, critical
$client->debug('service-name', 'Debug message', ['detail' => 'value']);
$client->info('api-gateway', 'Request received', ['method' => 'GET', 'path' => '/users']);
$client->warn('cache', 'Cache miss', ['key' => 'user:123']);
$client->error('database', 'Query failed', ['query' => 'SELECT *']);
$client->critical('system', 'Out of memory', ['used' => '95%']);`}
            />
        </div>

        <div>
            <h3 id="scoped-trace-id" class="text-lg font-semibold mb-3 scroll-mt-20">Scoped Trace ID</h3>
            <CodeBlock
                lang="php"
                code={`<?php

// All logs within this scope have the same trace_id
$client->withTraceId('550e8400-e29b-41d4-a716-446655440000', function() use ($client) {
    $client->info('api', 'Processing request');
    $client->info('db', 'Query executed');
});`}
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
            <h3 id="laravel-middleware" class="text-lg font-semibold mb-3 scroll-mt-20">Laravel Middleware</h3>
            <CodeBlock
                lang="php"
                code={`<?php

// app/Http/Kernel.php
protected $middleware = [
    // ... other middleware
    \\LogWard\\SDK\\Middleware\\LaravelLogWardMiddleware::class,
];

// config/services.php
'logward' => [
    'api_url' => env('LOGWARD_API_URL', 'http://localhost'),
    'api_key' => env('LOGWARD_API_KEY'),
],`}
            />
        </div>

        <div>
            <h3 id="symfony-subscriber" class="text-lg font-semibold mb-3 scroll-mt-20">Symfony Event Subscriber</h3>
            <CodeBlock
                lang="php"
                code={`<?php

// config/services.yaml
services:
    LogWard\\SDK\\Middleware\\SymfonyLogWardSubscriber:
        arguments:
            $client: '@LogWard\\SDK\\LogWardClient'
        tags:
            - { name: kernel.event_subscriber }
    
    LogWard\\SDK\\LogWardClient:
        arguments:
            $options: !service
                class: LogWard\\SDK\\Models\\LogWardClientOptions
                arguments:
                    $apiUrl: '%env(LOGWARD_API_URL)%'
                    $apiKey: '%env(LOGWARD_API_KEY)%'`}
            />
        </div>

        <div>
            <h3 id="psr15-middleware" class="text-lg font-semibold mb-3 scroll-mt-20">PSR-15 Middleware</h3>
            <CodeBlock
                lang="php"
                code={`<?php

use LogWard\\SDK\\Middleware\\Psr15LogWardMiddleware;

$middleware = new Psr15LogWardMiddleware($client);

// Add to your PSR-15 middleware stack
$app->pipe($middleware);`}
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
            lang="php"
            code={`<?php

// Search logs
$result = $client->query([
    'service' => 'api-gateway',
    'level' => 'error',
    'from' => '2025-01-15T00:00:00Z',
    'to' => '2025-01-15T23:59:59Z',
    'q' => 'timeout',  // Full-text search
    'limit' => 100
]);

echo "Found {$result['total']} error logs\\n";
foreach ($result['logs'] as $log) {
    echo "[{$log['time']}] {$log['message']}\\n";
}`}
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
                    >1. Automatic Shutdown Handling</CardTitle
                >
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                The SDK automatically registers a shutdown function to flush
                logs on script termination. No manual cleanup needed!
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base"
                    >2. Use Enums for Log Levels</CardTitle
                >
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                PHP 8.1+ enums provide type safety. Use <code
                    >LogLevel::ERROR</code
                > instead of strings where possible.
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">3. Leverage Middleware</CardTitle>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Framework middleware automatically logs all requests with
                response times, status codes, and trace IDs.
            </CardContent>
        </Card>
    </div>
</div>

<style>
    .docs-content :global(code:not(pre code)) {
        padding-left: 0.375rem;
        padding-right: 0.375rem;
        padding-top: 0.125rem;
        padding-bottom: 0.125rem;
        background-color: hsl(var(--muted));
        border-radius: 0.25rem;
        font-size: 0.875rem;
        font-family: ui-monospace, monospace;
    }
</style>
