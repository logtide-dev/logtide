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
        <h1 class="text-3xl font-bold">Python SDK</h1>
        <a
            href="https://github.com/logward-dev/logward-sdk-python"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
            <ExternalLink class="w-4 h-4" />
            GitHub
        </a>
    </div>

    <p class="text-lg text-muted-foreground mb-8">
        Official Python SDK for LogWard with full type hints support, automatic
        batching, retry logic, and Flask/Django/FastAPI middleware.
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
            code={`pip install logward-sdk

# or with poetry
poetry add logward-sdk`}
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
            lang="python"
            code={`from logward_sdk import LogWardClient

client = LogWardClient(
    api_url="http://localhost:8080",
    api_key="lp_your_api_key_here"
)

# Send logs
client.info("api-gateway", "Server started", {"port": 3000})
client.error("database", "Connection failed", Exception("Timeout"))

# Graceful shutdown
import atexit
atexit.register(client.close)`}
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
                        ✅ Flask, Django & FastAPI middleware for auto-logging
                        HTTP requests
                    </li>
                    <li>✅ Full Python 3.8+ support with type hints</li>
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
            lang="python"
            code={`client = LogWardClient(
    # Required
    api_url="http://localhost:8080",
    api_key="lp_your_api_key",
    
    # Optional - Performance
    batch_size=100,              # Max logs per batch (default: 100)
    batch_interval=5.0,          # Flush interval in seconds (default: 5.0)
    max_buffer_size=10000,       # Max logs in buffer (default: 10000)
    
    # Optional - Reliability
    max_retries=3,               # Max retry attempts (default: 3)
    retry_delay=1.0,             # Initial retry delay in seconds (default: 1.0)
    circuit_breaker_threshold=5, # Failures before circuit opens (default: 5)
    circuit_breaker_timeout=60,  # Circuit reset timeout in seconds (default: 60)
    
    # Optional - Metadata
    global_metadata={            # Added to all logs
        "environment": "production",
        "version": "1.0.0"
    },
    
    # Optional - Debug
    debug=False                  # Enable debug logging (default: False)
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
            <h3 id="basic-logging" class="text-lg font-semibold mb-3 scroll-mt-20">Basic Logging</h3>
            <CodeBlock
                lang="python"
                code={`# Log levels: debug, info, warn, error, critical
client.debug("service-name", "Debug message", {"detail": "value"})
client.info("api-gateway", "Request received", {"method": "GET", "path": "/users"})
client.warn("cache", "Cache miss", {"key": "user:123"})
client.error("database", "Query failed", {"query": "SELECT *"})
client.critical("system", "Out of memory", {"used": "95%"})`}
            />
        </div>

        <div>
            <h3 id="trace-context" class="text-lg font-semibold mb-3 scroll-mt-20">
                Context Manager for Trace IDs
            </h3>
            <CodeBlock
                lang="python"
                code={`# Scoped trace ID
with client.trace_context("550e8400-e29b-41d4-a716-446655440000"):
    client.info("api", "Processing request")
    client.info("db", "Query executed")
    # All logs in this block have the same trace_id`}
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
            <h3 id="flask-middleware" class="text-lg font-semibold mb-3 scroll-mt-20">Flask Middleware</h3>
            <CodeBlock
                lang="python"
                code={`from flask import Flask
from logward_sdk.middleware import FlaskLogWardMiddleware

app = Flask(__name__)

# Add LogWard middleware
app.wsgi_app = FlaskLogWardMiddleware(
    app.wsgi_app,
    client=client,
    include_headers=True,
    include_response_time=True
)

@app.route("/users")
def get_users():
    return {"users": []}

# Logs automatically sent for each request`}
            />
        </div>

        <div>
            <h3 id="django-middleware" class="text-lg font-semibold mb-3 scroll-mt-20">Django Middleware</h3>
            <CodeBlock
                lang="python"
                code={`# settings.py
MIDDLEWARE = [
    # ... other middleware
    'logward_sdk.middleware.DjangoLogWardMiddleware',
]

# Configure client globally
from logward_sdk import LogWardClient

LOGWARD_CLIENT = LogWardClient(
    api_url="http://localhost:8080",
    api_key="lp_your_api_key"
)`}
            />
        </div>

        <div>
            <h3 id="fastapi-middleware" class="text-lg font-semibold mb-3 scroll-mt-20">FastAPI Middleware</h3>
            <CodeBlock
                lang="python"
                code={`from fastapi import FastAPI
from logward_sdk.middleware import FastAPILogWardMiddleware

app = FastAPI()

# Add LogWard middleware
app.add_middleware(
    FastAPILogWardMiddleware,
    client=client,
    include_headers=True,
    include_response_time=True
)

@app.get("/users")
async def get_users():
    return {"users": []}

# Logs automatically sent for each request`}
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
            lang="python"
            code={`# Search logs
result = client.query(
    service="api-gateway",
    level="error",
    from_time="2025-01-15T00:00:00Z",
    to_time="2025-01-15T23:59:59Z",
    q="timeout",  # Full-text search
    limit=100
)

print(f"Found {result['total']} error logs")
for log in result['logs']:
    print(f"[{log['time']}] {log['message']}")`}
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
                Use <code>atexit.register(client.close)</code> or call
                <code>client.close()</code> in shutdown handlers to flush remaining
                logs.
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
                    >3. Use Context Managers for Tracing</CardTitle
                >
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Leverage <code>with client.trace_context()</code> to automatically
                add trace IDs to related logs.
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
