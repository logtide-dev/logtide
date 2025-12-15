<script lang="ts">
    import Breadcrumbs from "$lib/components/docs/Breadcrumbs.svelte";
    import CodeBlock from "$lib/components/docs/CodeBlock.svelte";
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import {
        Collapsible,
        CollapsibleContent,
        CollapsibleTrigger,
    } from "$lib/components/ui/collapsible";
    import { Button } from "$lib/components/ui/button";
    import { CheckCircle2, Cloud, Server, ChevronDown } from "lucide-svelte";
</script>

<div class="docs-content">
    <Breadcrumbs />

    <h1 class="text-3xl font-bold mb-2">Getting Started</h1>
    <p class="text-lg text-muted-foreground mb-8">
        Open-source log management. Privacy-first. Self-hosted or cloud.
    </p>

    <h2
        id="deployment-options"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Deployment Options
    </h2>

    <div class="mb-8 grid md:grid-cols-2 gap-6">
        <!-- Cloud Option -->
        <Card class="border-2">
            <CardHeader>
                <div class="flex items-center gap-2 mb-2">
                    <Cloud class="w-5 h-5 text-primary" />
                    <CardTitle>Managed Cloud</CardTitle>
                </div>
                <CardDescription>
                    Zero setup required. Start logging in seconds.
                </CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
                <ul class="space-y-2 text-sm">
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Instant access, no installation</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Automatic updates & backups</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>99.9% uptime SLA</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>API: <code>api.logward.dev</code></span>
                    </li>
                </ul>
                <a
                    href="https://logward.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-block"
                >
                    <Button class="w-full">Start Free →</Button>
                </a>
            </CardContent>
        </Card>

        <!-- Self-Hosted Option -->
        <Card class="border-2">
            <CardHeader>
                <div class="flex items-center gap-2 mb-2">
                    <Server class="w-5 h-5 text-primary" />
                    <CardTitle>Self-Hosted</CardTitle>
                </div>
                <CardDescription>
                    Full control. Privacy-first. Docker deployment.
                </CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
                <ul class="space-y-2 text-sm">
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>100% data ownership</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>GDPR-compliant by design</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>One-command deployment</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>License: AGPLv3</span>
                    </li>
                </ul>
                <a href="#self-hosted" class="inline-block w-full">
                    <Button variant="secondary" class="w-full">
                        Quick Start ↓
                    </Button>
                </a>
            </CardContent>
        </Card>
    </div>

    <h2
        id="self-hosted"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Self-Hosted Quick Start
    </h2>

    <div class="mb-8 space-y-6">
        <div>
            <h3 id="prerequisites" class="text-lg font-semibold mb-3 scroll-mt-20">Prerequisites</h3>
            <ul class="space-y-2 ml-6">
                <li class="flex items-start gap-2">
                    <CheckCircle2
                        class="w-5 h-5 text-primary mt-0.5 flex-shrink-0"
                    />
                    <span
                        ><strong>Docker Engine</strong> - Container runtime</span
                    >
                </li>
                <li class="flex items-start gap-2">
                    <CheckCircle2
                        class="w-5 h-5 text-primary mt-0.5 flex-shrink-0"
                    />
                    <span
                        ><strong>Docker Compose</strong> - Multi-container orchestration</span
                    >
                </li>
            </ul>
            <p class="text-sm text-muted-foreground mt-3 ml-6">
                That's it! No Node.js, no build tools, no database setup. Uses pre-built images from Docker Hub.
            </p>
        </div>

        <div>
            <h3 id="installation" class="text-lg font-semibold mb-3 scroll-mt-20">Installation (2 minutes)</h3>
            <CodeBlock
                lang="bash"
                code={`# 1. Create project directory
mkdir logward && cd logward

# 2. Download configuration files
curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/docker-compose.yml
curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/.env.example
mv .env.example .env

# 3. Configure secure passwords (IMPORTANT!)
nano .env
# Change: DB_PASSWORD, REDIS_PASSWORD, API_KEY_SECRET

# 4. Start LogWard
docker compose up -d

# 5. Access the dashboard
# Frontend: http://localhost:3000
# API: http://localhost:8080`}
            />
        </div>

        <Card class="bg-muted/50">
            <CardHeader>
                <CardTitle class="text-base"
                    >What happens automatically</CardTitle
                >
            </CardHeader>
            <CardContent class="text-sm">
                <ul class="space-y-2 ml-2">
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Pulls pre-built images from Docker Hub</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Starts PostgreSQL + TimescaleDB (database)</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Starts Redis (queue & cache)</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Runs database migrations</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Starts backend API & worker</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Starts frontend dashboard</span>
                    </li>
                </ul>
            </CardContent>
        </Card>

        <div>
            <h3 id="required-configuration" class="text-lg font-semibold mb-3 scroll-mt-20">Required Configuration</h3>
            <p class="text-muted-foreground mb-3">
                Edit your <code>.env</code> file and set secure values for these variables:
            </p>
            <div class="overflow-x-auto">
                <table class="w-full text-sm border border-border rounded-lg">
                    <thead class="bg-muted">
                        <tr>
                            <th class="text-left p-3 border-b border-border">Variable</th>
                            <th class="text-left p-3 border-b border-border">Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">DB_PASSWORD</td>
                            <td class="p-3 border-b border-border">PostgreSQL database password</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">REDIS_PASSWORD</td>
                            <td class="p-3 border-b border-border">Redis password</td>
                        </tr>
                        <tr>
                            <td class="p-3 font-mono text-xs">API_KEY_SECRET</td>
                            <td class="p-3">Encryption key (32+ characters)</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p class="text-sm text-muted-foreground mt-3">
                Database migrations run automatically on first start.
            </p>
        </div>

        <Card class="border-primary/30 bg-primary/5">
            <CardHeader>
                <CardTitle class="text-base">Docker Images</CardTitle>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p class="mb-2">Pre-built images are available from:</p>
                <ul class="space-y-1 ml-4">
                    <li><strong>Docker Hub:</strong> <code>logward/backend</code>, <code>logward/frontend</code></li>
                    <li><strong>GitHub:</strong> <code>ghcr.io/logward-dev/logward-backend</code></li>
                </ul>
                <p class="mt-3 text-xs">
                    Pin versions in production: <code>LOGWARD_BACKEND_IMAGE=logward/backend:0.3.1</code>
                </p>
            </CardContent>
        </Card>
    </div>

    <h2
        id="first-steps"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        First Steps
    </h2>

    <div class="mb-8 space-y-6">
        <div>
            <h3 id="create-organization" class="text-lg font-semibold mb-2 scroll-mt-20">
                1. Create Your Organization
            </h3>
            <p class="text-muted-foreground">
                After logging in, create your first organization to get started.
                Organizations are top-level containers for your projects.
            </p>
        </div>

        <div>
            <h3 id="create-project" class="text-lg font-semibold mb-2 scroll-mt-20">2. Create a Project</h3>
            <p class="text-muted-foreground">
                Each organization can have multiple projects (e.g.,
                "production", "staging"). Projects isolate logs and have their
                own API keys.
            </p>
        </div>

        <div>
            <h3 id="generate-api-key" class="text-lg font-semibold mb-2 scroll-mt-20">3. Generate an API Key</h3>
            <p class="text-muted-foreground">
                In your project settings, create an API key to start sending
                logs. Save it securely - it's shown only once!
            </p>
        </div>

        <div>
            <h3 id="send-first-log" class="text-lg font-semibold mb-2 scroll-mt-20">4. Send Your First Log</h3>
            <p class="text-muted-foreground mb-3">
                Use the ingestion API to send logs:
            </p>

            <div class="space-y-4">
                <div>
                    <h4 class="text-sm font-semibold mb-2">
                        Cloud (api.logward.dev)
                    </h4>
                    <CodeBlock
                        lang="bash"
                        code={`curl -X POST https://api.logward.dev/api/v1/ingest \\
  -H "X-API-Key: lp_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "logs": [{
      "time": "2025-01-23T10:30:00Z",
      "service": "my-app",
      "level": "info",
      "message": "Hello from LogWard Cloud!",
      "metadata": {
        "environment": "production"
      }
    }]
  }'`}
                    />
                </div>

                <div>
                    <h4 class="text-sm font-semibold mb-2">
                        Self-Hosted
                    </h4>
                    <CodeBlock
                        lang="bash"
                        code={`curl -X POST http://localhost:8080/api/v1/ingest \\
  -H "X-API-Key: lp_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "logs": [{
      "time": "2025-01-23T10:30:00Z",
      "service": "my-app",
      "level": "info",
      "message": "Hello from LogWard!",
      "metadata": {
        "environment": "production"
      }
    }]
  }'`}
                    />
                </div>
            </div>
        </div>
    </div>

    <h2
        id="next"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Next Steps
    </h2>

    <div class="grid md:grid-cols-2 gap-4 mb-8">
        <a href="/docs/sdks" class="block">
            <Card class="transition-colors hover:border-primary h-full">
                <CardHeader>
                    <CardTitle class="text-base">Use an SDK</CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    Official SDKs for Node.js, Python, PHP, and Kotlin
                </CardContent>
            </Card>
        </a>

        <a href="/docs/api" class="block">
            <Card class="transition-colors hover:border-primary h-full">
                <CardHeader>
                    <CardTitle class="text-base">API Reference</CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    Explore all available API endpoints and examples
                </CardContent>
            </Card>
        </a>

        <a href="/docs/deployment" class="block">
            <Card class="transition-colors hover:border-primary h-full">
                <CardHeader>
                    <CardTitle class="text-base">Deployment Guide</CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    Production deployment, SSL setup, and best practices
                </CardContent>
            </Card>
        </a>

        <a href="/docs/architecture" class="block">
            <Card class="transition-colors hover:border-primary h-full">
                <CardHeader>
                    <CardTitle class="text-base">Architecture</CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    Understand how LogWard works under the hood
                </CardContent>
            </Card>
        </a>
    </div>

    <!-- Development Setup (Collapsed) -->
    <Collapsible class="mb-8">
        <Card>
            <CardHeader>
                <CollapsibleTrigger class="w-full">
                    <div
                        class="flex items-center justify-between w-full hover:text-foreground transition-colors"
                    >
                        <CardTitle class="text-base">
                            For Contributors: Development Setup
                        </CardTitle>
                        <ChevronDown
                            class="w-5 h-5 transition-transform [[data-state=open]>&]:rotate-180"
                        />
                    </div>
                </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
                <CardContent class="space-y-4 pt-0">
                    <p class="text-sm text-muted-foreground">
                        Want to contribute to LogWard? Set up a local
                        development environment with hot-reloading.
                    </p>

                    <div>
                        <h4 class="text-sm font-semibold mb-2">
                            Development Prerequisites
                        </h4>
                        <ul class="space-y-2 ml-6 text-sm">
                            <li class="flex items-start gap-2">
                                <CheckCircle2
                                    class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                                />
                                <span
                                    ><strong>Node.js 20+</strong> - JavaScript runtime</span
                                >
                            </li>
                            <li class="flex items-start gap-2">
                                <CheckCircle2
                                    class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                                />
                                <span
                                    ><strong>pnpm 8+</strong> - Package manager</span
                                >
                            </li>
                            <li class="flex items-start gap-2">
                                <CheckCircle2
                                    class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                                />
                                <span
                                    ><strong>Docker & Docker Compose</strong> - For
                                    databases</span
                                >
                            </li>
                        </ul>
                    </div>

                    <div>
                        <h4 class="text-sm font-semibold mb-2">Setup Steps</h4>
                        <CodeBlock
                            lang="bash"
                            code={`# Clone the repository
git clone https://github.com/logward-dev/logward.git
cd logward

# Install dependencies
pnpm install

# Build shared package
pnpm run build:shared

# Start development databases
cd docker
docker-compose -f docker-compose.dev.yml up -d
cd ..

# Run database migrations
pnpm --filter '@logward/backend' migrate

# Start development servers
pnpm dev`}
                        />
                    </div>

                    <Card class="bg-muted/50">
                        <CardHeader>
                            <CardTitle class="text-sm"
                                >Access Points (Development)</CardTitle
                            >
                        </CardHeader>
                        <CardContent class="text-sm">
                            <ul class="space-y-1">
                                <li>
                                    Frontend: <code
                                        class="px-1.5 py-0.5 bg-background rounded"
                                        >http://localhost:3000</code
                                    >
                                </li>
                                <li>
                                    Backend API: <code
                                        class="px-1.5 py-0.5 bg-background rounded"
                                        >http://localhost:8080</code
                                    >
                                </li>
                            </ul>
                        </CardContent>
                    </Card>

                    <p class="text-sm text-muted-foreground">
                        For more details, see our <a
                            href="/docs/contributing"
                            class="text-primary underline">Contributing Guide</a
                        >.
                    </p>
                </CardContent>
            </CollapsibleContent>
        </Card>
    </Collapsible>
</div>

<style>
    .docs-content :global(h2) {
        @apply scroll-mt-20;
    }

    .docs-content :global(code:not(pre code)) {
        @apply px-1.5 py-0.5 bg-muted rounded text-sm font-mono;
    }
</style>
