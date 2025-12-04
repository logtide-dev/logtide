<script lang="ts">
    import Breadcrumbs from "$lib/components/docs/Breadcrumbs.svelte";
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
        CardDescription,
    } from "$lib/components/ui/card";
    import { Button } from "$lib/components/ui/button";
    import { ExternalLink, Package } from "lucide-svelte";
</script>

<div class="docs-content">
    <Breadcrumbs />

    <h1 class="text-3xl font-bold mb-4">Official SDKs</h1>
    <p class="text-lg text-muted-foreground mb-8">
        LogWard provides official SDKs for multiple programming languages,
        making it easy to integrate log management into your applications.
    </p>

    <div class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-8">
        <div class="flex items-start gap-3">
            <div class="flex-1">
                <p class="font-semibold text-blue-600 dark:text-blue-400 mb-1">
                    Don't want to install an SDK?
                </p>
                <p class="text-sm text-muted-foreground mb-2">
                    No problem! LogWard supports stdout-based logging for
                    <strong>any language</strong> (Rust, Ruby, Java, .NET, etc.).
                    Just write to stdout and let Fluent Bit collect your logs automatically.
                </p>
                <a
                    href="/docs/no-sdk-setup"
                    class="text-primary underline text-sm"
                >
                    Learn more about No-SDK Setup →
                </a>
            </div>
        </div>
    </div>

    <h2
        id="available-sdks"
        class="text-2xl font-semibold mb-6 scroll-mt-20 border-b border-border pb-2"
    >
        Available SDKs
    </h2>

    <div class="grid md:grid-cols-2 gap-6 mb-12">
        <!-- Node.js SDK -->
        <Card>
            <CardHeader>
                <div class="flex items-center justify-between">
                    <CardTitle class="flex items-center gap-2">
                        <Package class="w-5 h-5 text-primary" />
                        Node.js SDK
                    </CardTitle>
                    <a
                        href="https://github.com/logward-dev/logward-sdk-node"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Button variant="ghost" size="sm" class="gap-1">
                            <ExternalLink class="w-4 h-4" />
                        </Button>
                    </a>
                </div>
                <CardDescription
                    >Official SDK for Node.js and TypeScript applications</CardDescription
                >
            </CardHeader>
            <CardContent>
                <div class="space-y-3">
                    <div>
                        <p class="text-sm font-semibold mb-1">Installation:</p>
                        <code class="text-xs bg-muted px-2 py-1 rounded"
                            >npm install @logward-dev/sdk-node</code
                        >
                    </div>
                    <div>
                        <p class="text-sm font-semibold mb-1">Features:</p>
                        <ul class="text-sm text-muted-foreground space-y-1">
                            <li>✅ Express & Fastify middleware</li>
                            <li>✅ Full TypeScript support</li>
                            <li>✅ Automatic batching & retry</li>
                        </ul>
                    </div>
                    <a href="/docs/sdks/nodejs">
                        <Button variant="outline" size="sm" class="w-full mt-2"
                            >View Documentation</Button
                        >
                    </a>
                </div>
            </CardContent>
        </Card>

        <!-- Python SDK -->
        <Card>
            <CardHeader>
                <div class="flex items-center justify-between">
                    <CardTitle class="flex items-center gap-2">
                        <Package class="w-5 h-5 text-primary" />
                        Python SDK
                    </CardTitle>
                    <a
                        href="https://github.com/logward-dev/logward-sdk-python"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Button variant="ghost" size="sm" class="gap-1">
                            <ExternalLink class="w-4 h-4" />
                        </Button>
                    </a>
                </div>
                <CardDescription
                    >Official SDK for Python 3.8+ applications</CardDescription
                >
            </CardHeader>
            <CardContent>
                <div class="space-y-3">
                    <div>
                        <p class="text-sm font-semibold mb-1">Installation:</p>
                        <code class="text-xs bg-muted px-2 py-1 rounded"
                            >pip install logward-sdk</code
                        >
                    </div>
                    <div>
                        <p class="text-sm font-semibold mb-1">Features:</p>
                        <ul class="text-sm text-muted-foreground space-y-1">
                            <li>✅ Flask, Django & FastAPI middleware</li>
                            <li>✅ Type hints support</li>
                            <li>✅ Context managers for tracing</li>
                        </ul>
                    </div>
                    <a href="/docs/sdks/python">
                        <Button variant="outline" size="sm" class="w-full mt-2"
                            >View Documentation</Button
                        >
                    </a>
                </div>
            </CardContent>
        </Card>

        <!-- Go SDK -->
        <Card>
            <CardHeader>
                <div class="flex items-center justify-between">
                    <CardTitle class="flex items-center gap-2">
                        <Package class="w-5 h-5 text-primary" />
                        Go SDK
                    </CardTitle>
                    <a
                        href="https://github.com/logward-dev/logward-sdk-go"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Button variant="ghost" size="sm" class="gap-1">
                            <ExternalLink class="w-4 h-4" />
                        </Button>
                    </a>
                </div>
                <CardDescription
                    >Official SDK for Go applications</CardDescription
                >
            </CardHeader>
            <CardContent>
                <div class="space-y-3">
                    <div>
                        <p class="text-sm font-semibold mb-1">Installation:</p>
                        <code class="text-xs bg-muted px-2 py-1 rounded"
                            >go get github.com/logward-dev/logward-sdk-go</code
                        >
                    </div>
                    <div>
                        <p class="text-sm font-semibold mb-1">Features:</p>
                        <ul class="text-sm text-muted-foreground space-y-1">
                            <li>✅ Goroutine-safe logging</li>
                            <li>✅ Automatic batching & retry</li>
                            <li>✅ Context support for tracing</li>
                        </ul>
                    </div>
                    <a href="/docs/sdks/go">
                        <Button variant="outline" size="sm" class="w-full mt-2"
                            >View Documentation</Button
                        >
                    </a>
                </div>
            </CardContent>
        </Card>

        <!-- PHP SDK -->
        <Card>
            <CardHeader>
                <div class="flex items-center justify-between">
                    <CardTitle class="flex items-center gap-2">
                        <Package class="w-5 h-5 text-primary" />
                        PHP SDK
                    </CardTitle>
                    <a
                        href="https://github.com/logward-dev/logward-sdk-php"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Button variant="ghost" size="sm" class="gap-1">
                            <ExternalLink class="w-4 h-4" />
                        </Button>
                    </a>
                </div>
                <CardDescription
                    >Official SDK for PHP 8.1+ applications</CardDescription
                >
            </CardHeader>
            <CardContent>
                <div class="space-y-3">
                    <div>
                        <p class="text-sm font-semibold mb-1">Installation:</p>
                        <code class="text-xs bg-muted px-2 py-1 rounded"
                            >composer require logward/sdk-php</code
                        >
                    </div>
                    <div>
                        <p class="text-sm font-semibold mb-1">Features:</p>
                        <ul class="text-sm text-muted-foreground space-y-1">
                            <li>✅ Laravel, Symfony & PSR-15 middleware</li>
                            <li>✅ Strict types & enums</li>
                            <li>✅ Auto-shutdown handling</li>
                        </ul>
                    </div>
                    <a href="/docs/sdks/php">
                        <Button variant="outline" size="sm" class="w-full mt-2"
                            >View Documentation</Button
                        >
                    </a>
                </div>
            </CardContent>
        </Card>

        <!-- Kotlin SDK -->
        <Card>
            <CardHeader>
                <div class="flex items-center justify-between">
                    <CardTitle class="flex items-center gap-2">
                        <Package class="w-5 h-5 text-primary" />
                        Kotlin SDK
                    </CardTitle>
                    <a
                        href="https://github.com/logward-dev/logward-sdk-kotlin"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Button variant="ghost" size="sm" class="gap-1">
                            <ExternalLink class="w-4 h-4" />
                        </Button>
                    </a>
                </div>
                <CardDescription
                    >Official SDK for Kotlin & JVM applications</CardDescription
                >
            </CardHeader>
            <CardContent>
                <div class="space-y-3">
                    <div>
                        <p class="text-sm font-semibold mb-1">Installation:</p>
                        <code class="text-xs bg-muted px-2 py-1 rounded"
                            >implementation("io.github.logward-dev:logward-sdk-kotlin:0.2.1")</code
                        >
                    </div>
                    <div>
                        <p class="text-sm font-semibold mb-1">Features:</p>
                        <ul class="text-sm text-muted-foreground space-y-1">
                            <li>✅ Coroutines support</li>
                            <li>✅ Ktor, Spring Boot & Jakarta middleware</li>
                            <li>✅ Multiplatform ready</li>
                        </ul>
                    </div>
                    <a href="/docs/sdks/kotlin">
                        <Button variant="outline" size="sm" class="w-full mt-2"
                            >View Documentation</Button
                        >
                    </a>
                </div>
            </CardContent>
        </Card>
    </div>

    <h2
        id="common-features"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Common Features
    </h2>

    <div class="mb-8">
        <p class="mb-4 text-muted-foreground">
            All LogWard SDKs share these core features:
        </p>

        <div class="grid md:grid-cols-2 gap-4">
            <Card class="flex flex-col h-full">
                <CardHeader>
                    <CardTitle class="text-base">🚀 Performance</CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    <ul class="space-y-1">
                        <li>• Automatic batching for efficiency</li>
                        <li>• Configurable batch size and intervals</li>
                        <li>• Async processing to avoid blocking</li>
                    </ul>
                </CardContent>
            </Card>

            <Card class="flex flex-col h-full">
                <CardHeader>
                    <CardTitle class="text-base">🛡️ Reliability</CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    <ul class="space-y-1">
                        <li>• Retry logic with exponential backoff</li>
                        <li>• Circuit breaker for fault tolerance</li>
                        <li>• Max buffer size to prevent memory leaks</li>
                    </ul>
                </CardContent>
            </Card>

            <Card class="flex flex-col h-full">
                <CardHeader>
                    <CardTitle class="text-base">🔍 Query & Streaming</CardTitle
                    >
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    <ul class="space-y-1">
                        <li>• Query API for log search</li>
                        <li>• Live tail with Server-Sent Events</li>
                        <li>• Trace ID correlation support</li>
                    </ul>
                </CardContent>
            </Card>

            <Card class="flex flex-col h-full">
                <CardHeader>
                    <CardTitle class="text-base">📊 Observability</CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    <ul class="space-y-1">
                        <li>• Internal metrics (sent, errors, latency)</li>
                        <li>• Global metadata support</li>
                        <li>• Structured error serialization</li>
                    </ul>
                </CardContent>
            </Card>
        </div>
    </div>

    <h2
        id="next-steps"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Next Steps
    </h2>

    <p class="text-muted-foreground mb-4">
        Choose your SDK and follow the documentation to integrate LogWard into
        your application. Each SDK page includes:
    </p>

    <ul class="list-disc ml-6 text-muted-foreground space-y-2 mb-6">
        <li>Installation instructions</li>
        <li>Quick start examples</li>
        <li>Configuration options</li>
        <li>Framework middleware integration</li>
        <li>API reference</li>
    </ul>
</div>

<style>
    .docs-content :global(code:not(pre code)) {
        @apply px-1.5 py-0.5 bg-muted rounded text-sm font-mono;
    }
</style>
