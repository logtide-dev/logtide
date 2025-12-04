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
        <h1 class="text-3xl font-bold">Go SDK</h1>
        <a
            href="https://github.com/logward-dev/logward-sdk-go"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
            <ExternalLink class="w-4 h-4" />
            GitHub
        </a>
    </div>

    <p class="text-lg text-muted-foreground mb-8">
        Official Go SDK for LogWard with automatic batching, retry logic,
        circuit breaker pattern, and native OpenTelemetry integration.
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
            code={`go get github.com/logward-dev/logward-sdk-go`}
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
            lang="go"
            code={`package main

import (
    "context"
    "github.com/logward-dev/logward-sdk-go"
)

func main() {
    client, err := logward.New(
        logward.WithAPIKey("lp_your_api_key"),
        logward.WithService("my-service"),
    )
    if err != nil {
        panic(err)
    }
    defer client.Close()

    ctx := context.Background()

    // Send logs
    client.Info(ctx, "Server started", map[string]any{"port": 8080})
    client.Error(ctx, "Connection failed", map[string]any{"error": "timeout"})
}`}
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
                    <li>✅ Goroutine-safe logging</li>
                    <li>✅ Context support for request-scoped logging</li>
                    <li>✅ Native OpenTelemetry integration</li>
                    <li>✅ Graceful shutdown with flush</li>
                    <li>✅ Structured metadata support</li>
                    <li>✅ 87% test coverage</li>
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
            lang="go"
            code={`client, err := logward.New(
    // Required
    logward.WithAPIKey("lp_your_api_key"),
    logward.WithService("my-service"),

    // Optional - API
    logward.WithBaseURL("https://api.logward.dev"),

    // Optional - Performance
    logward.WithBatchSize(100),              // Max logs per batch (default: 100)
    logward.WithFlushInterval(5*time.Second), // Flush interval (default: 5s)
    logward.WithTimeout(30*time.Second),      // HTTP timeout (default: 30s)

    // Optional - Reliability
    logward.WithRetry(3, 1*time.Second, 60*time.Second), // maxRetries, delay, maxDelay
    logward.WithCircuitBreaker(5, 30*time.Second),       // threshold, timeout

    // Optional - Metadata
    logward.WithGlobalMetadata(map[string]any{
        "environment": "production",
        "version":     "1.0.0",
    }),
)`}
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
            <h3 class="text-lg font-semibold mb-3">Basic Logging</h3>
            <CodeBlock
                lang="go"
                code={`ctx := context.Background()

// Log levels: Debug, Info, Warn, Error, Critical
client.Debug(ctx, "Debug message", map[string]any{"detail": "value"})
client.Info(ctx, "Request received", map[string]any{"method": "GET", "path": "/users"})
client.Warn(ctx, "Cache miss", map[string]any{"key": "user:123"})
client.Error(ctx, "Query failed", map[string]any{"query": "SELECT *"})
client.Critical(ctx, "Out of memory", map[string]any{"used": "95%"})`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">With Trace ID</h3>
            <CodeBlock
                lang="go"
                code={`// Add trace ID to context
ctx := logward.WithTraceID(context.Background(), "550e8400-e29b-41d4-a716-446655440000")

// All logs will include the trace ID
client.Info(ctx, "Processing request", nil)
client.Info(ctx, "Query executed", nil)`}
            />
        </div>
    </div>

    <h2
        id="error-handling"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Error Handling
    </h2>

    <div class="mb-8">
        <CodeBlock
            lang="go"
            code={`err := client.Info(ctx, "message", nil)
if err != nil {
    switch {
    case errors.Is(err, logward.ErrClientClosed):
        // Client was closed, logs won't be sent
    case errors.Is(err, logward.ErrCircuitOpen):
        // Circuit breaker is open, too many failures
    case errors.Is(err, logward.ErrInvalidAPIKey):
        // Invalid API key configuration
    default:
        // Other error
        log.Printf("Failed to send log: %v", err)
    }
}`}
        />
    </div>

    <h2
        id="opentelemetry"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        OpenTelemetry Integration
    </h2>

    <div class="mb-8">
        <CodeBlock
            lang="go"
            code={`import (
    "go.opentelemetry.io/otel"
)

tracer := otel.Tracer("my-service")

func handleRequest(ctx context.Context) {
    ctx, span := tracer.Start(ctx, "handle-request")
    defer span.End()

    // Trace ID and Span ID are automatically extracted from context
    client.Info(ctx, "Processing request", map[string]any{
        "user_id": 123,
    })

    // Nested spans work too
    ctx, dbSpan := tracer.Start(ctx, "database-query")
    client.Debug(ctx, "Executing query", nil)
    dbSpan.End()
}`}
        />
    </div>

    <h2
        id="http-middleware"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        HTTP Middleware
    </h2>

    <div class="mb-8 space-y-6">
        <div>
            <h3 class="text-lg font-semibold mb-3">Standard Library</h3>
            <CodeBlock
                lang="go"
                code={`func LoggingMiddleware(client *logward.Client) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            start := time.Now()

            // Create wrapped response writer to capture status
            wrapped := &responseWriter{ResponseWriter: w, statusCode: 200}

            next.ServeHTTP(wrapped, r)

            client.Info(r.Context(), "HTTP request", map[string]any{
                "method":      r.Method,
                "path":        r.URL.Path,
                "status":      wrapped.statusCode,
                "duration_ms": time.Since(start).Milliseconds(),
            })
        })
    }
}

// Usage
mux := http.NewServeMux()
handler := LoggingMiddleware(client)(mux)
http.ListenAndServe(":8080", handler)`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Gin Framework</h3>
            <CodeBlock
                lang="go"
                code={`func GinLoggingMiddleware(client *logward.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        start := time.Now()

        c.Next()

        client.Info(c.Request.Context(), "HTTP request", map[string]any{
            "method":      c.Request.Method,
            "path":        c.Request.URL.Path,
            "status":      c.Writer.Status(),
            "duration_ms": time.Since(start).Milliseconds(),
        })
    }
}

// Usage
r := gin.Default()
r.Use(GinLoggingMiddleware(client))`}
            />
        </div>
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
                    >1. Always Defer Close</CardTitle
                >
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Use <code>defer client.Close()</code> immediately after creating
                the client to ensure all buffered logs are flushed on shutdown.
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">2. Pass Context</CardTitle>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Always pass the request context to logging methods. This enables
                trace correlation and allows logs to be cancelled with the request.
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base"
                    >3. Use Global Metadata</CardTitle
                >
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Add environment, version, and hostname as global metadata
                instead of repeating them in every log call.
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base"
                    >4. Handle Errors Appropriately</CardTitle
                >
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Check for specific errors like <code>ErrCircuitOpen</code> to implement
                fallback logging strategies when LogWard is unavailable.
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
