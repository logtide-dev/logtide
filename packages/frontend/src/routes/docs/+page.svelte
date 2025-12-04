<script lang="ts">
    import Breadcrumbs from "$lib/components/docs/Breadcrumbs.svelte";
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { Button } from "$lib/components/ui/button";
    import {
        ArrowRight,
        Code,
        Rocket,
        Book,
        FileText,
        CheckCircle2,
    } from "lucide-svelte";
    import CodeBlock from "$lib/components/docs/CodeBlock.svelte";
</script>

<div class="docs-content">
    <Breadcrumbs />

    <!-- Hero Section -->
    <div class="mb-12">
        <h1
            class="text-4xl font-bold mb-4 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent"
        >
            LogWard Documentation
        </h1>
        <p class="text-xl text-muted-foreground">
            Privacy-first log management. Self-hosted or use our cloud at
            <code class="px-2 py-1 bg-muted rounded">api.logward.dev</code>.
        </p>
    </div>

    <!-- Deployment Options -->
    <section class="mb-12">
        <h2
            id="deployment-options"
            class="text-2xl font-semibold mb-6 scroll-mt-20"
        >
            Choose Your Deployment
        </h2>

        <div class="grid md:grid-cols-2 gap-6">
            <Card>
                <CardHeader>
                    <CardTitle class="flex items-center gap-2">
                        <Rocket class="w-5 h-5 text-primary" />
                        Cloud (Managed)
                    </CardTitle>
                    <CardDescription>
                        Start logging in 2 minutes - no infrastructure needed
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ul class="space-y-2 text-sm mb-4">
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                            />
                            <span>No setup required - instant access</span>
                        </li>
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                            />
                            <span>Automatic updates and maintenance</span>
                        </li>
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                            />
                            <span>Scalable infrastructure (we handle it)</span>
                        </li>
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                            />
                            <span
                                >API endpoint: <code>api.logward.dev</code
                                ></span
                            >
                        </li>
                    </ul>
                    <a href="/register">
                        <Button variant="default" size="sm" class="gap-1">
                            Sign Up Free
                            <ArrowRight class="w-3 h-3" />
                        </Button>
                    </a>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="flex items-center gap-2">
                        <Rocket class="w-5 h-5 text-primary" />
                        Self-Hosted
                    </CardTitle>
                    <CardDescription>
                        Full control, data privacy, GDPR-compliant
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ul class="space-y-2 text-sm mb-4">
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                            />
                            <span>100% data ownership and privacy</span>
                        </li>
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                            />
                            <span>No vendor lock-in (open source)</span>
                        </li>
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                            />
                            <span>Customize everything (code, infra)</span>
                        </li>
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                            />
                            <span>One-click install with Docker Compose</span>
                        </li>
                    </ul>
                    <a href="/docs/deployment">
                        <Button variant="outline" size="sm" class="gap-1">
                            Deployment Guide
                            <ArrowRight class="w-3 h-3" />
                        </Button>
                    </a>
                </CardContent>
            </Card>
        </div>
    </section>

    <!-- Quick Start -->
    <section class="mb-12">
        <h2 id="quick-start" class="text-2xl font-semibold mb-6 scroll-mt-20">
            Quick Start
        </h2>

        <div class="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle class="flex items-center gap-2">
                        <Rocket class="w-5 h-5 text-primary" />
                        Cloud: Start in 2 Minutes
                    </CardTitle>
                    <CardDescription>
                        Use LogWard Cloud - no installation needed
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <CodeBlock
                        lang="bash"
                        code={`# 1. Sign up at https://logward.dev
# 2. Create an organization and project
# 3. Generate an API key
# 4. Start sending logs:

curl -X POST https://api.logward.dev/api/v1/ingest \\
  -H "X-API-Key: lp_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "logs": [{
      "time": "2025-01-23T10:30:00Z",
      "service": "my-app",
      "level": "info",
      "message": "Hello from LogWard Cloud!"
    }]
  }'`}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="flex items-center gap-2">
                        <Rocket class="w-5 h-5 text-primary" />
                        Self-Hosted: Deploy in 2 Minutes
                    </CardTitle>
                    <CardDescription>
                        Run LogWard on your infrastructure with pre-built Docker images
                    </CardDescription>
                </CardHeader>
                <CardContent class="space-y-4">
                    <p class="text-sm text-muted-foreground">
                        1. Create a <code>docker-compose.yml</code> file:
                    </p>
                    <CodeBlock
                        lang="yaml"
                        code={`services:
  postgres:
    image: timescale/timescaledb:latest-pg16
    environment:
      POSTGRES_DB: logward
      POSTGRES_USER: logward
      POSTGRES_PASSWORD: \${DB_PASSWORD:-password}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U logward"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass \${REDIS_PASSWORD:-password}
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "sh", "-c", "redis-cli -a \${REDIS_PASSWORD:-password} ping | grep -q PONG"]
      interval: 10s
      timeout: 3s
      retries: 5

  backend:
    image: logward/backend:latest
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgresql://logward:\${DB_PASSWORD:-password}@postgres:5432/logward
      DATABASE_HOST: postgres
      DB_USER: logward
      REDIS_URL: redis://:\${REDIS_PASSWORD:-password}@redis:6379
      API_KEY_SECRET: \${API_KEY_SECRET:-change_me_32_chars_secret_key!!}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:8080/health', r => r.statusCode === 200 ? process.exit(0) : process.exit(1))"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 40s

  worker:
    image: logward/backend:latest
    command: ["worker"]
    environment:
      DATABASE_URL: postgresql://logward:\${DB_PASSWORD:-password}@postgres:5432/logward
      DATABASE_HOST: postgres
      DB_USER: logward
      REDIS_URL: redis://:\${REDIS_PASSWORD:-password}@redis:6379
      API_KEY_SECRET: \${API_KEY_SECRET:-change_me_32_chars_secret_key!!}
    depends_on:
      backend:
        condition: service_healthy
      redis:
        condition: service_healthy

  frontend:
    image: logward/frontend:latest
    ports:
      - "3000:3000"
    environment:
      PUBLIC_API_URL: http://localhost:8080
    depends_on:
      - backend

volumes:
  postgres_data:
  redis_data:`}
                    />
                    <p class="text-sm text-muted-foreground">
                        2. Create a <code>.env</code> file with secure passwords:
                    </p>
                    <CodeBlock
                        lang="bash"
                        code={`DB_PASSWORD=your_secure_db_password
REDIS_PASSWORD=your_secure_redis_password
API_KEY_SECRET=your_32_character_secret_key_here`}
                    />
                    <p class="text-sm text-muted-foreground">
                        3. Start LogWard:
                    </p>
                    <CodeBlock
                        lang="bash"
                        code={`docker compose up -d

# Access LogWard at http://localhost:3000`}
                    />
                    <p class="text-xs text-muted-foreground mt-2">
                        <strong>Note:</strong> Database migrations run automatically when the backend starts.
                    </p>
                </CardContent>
            </Card>
        </div>
    </section>

    <!-- Feature Cards -->
    <section class="mb-12">
        <h2 id="features" class="text-2xl font-semibold mb-6 scroll-mt-20">
            Key Features
        </h2>

        <div class="grid md:grid-cols-2 gap-6">
            <Card>
                <CardHeader>
                    <CardTitle class="flex items-center gap-2">
                        <Code class="w-5 h-5 text-primary" />
                        API-First Design
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p class="text-sm text-muted-foreground mb-3">
                        RESTful API with comprehensive documentation. Ingest,
                        query, and manage logs programmatically.
                    </p>
                    <a href="/docs/api">
                        <Button variant="outline" size="sm" class="gap-1">
                            View API Docs
                            <ArrowRight class="w-3 h-3" />
                        </Button>
                    </a>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="flex items-center gap-2">
                        <Rocket class="w-5 h-5 text-primary" />
                        Multi-Organization
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p class="text-sm text-muted-foreground mb-3">
                        Manage multiple teams and projects in one installation.
                        Complete data isolation per organization.
                    </p>
                    <a href="/docs/architecture">
                        <Button variant="outline" size="sm" class="gap-1">
                            Learn More
                            <ArrowRight class="w-3 h-3" />
                        </Button>
                    </a>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="flex items-center gap-2">
                        <Book class="w-5 h-5 text-primary" />
                        Real-time Streaming
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p class="text-sm text-muted-foreground mb-3">
                        Live tail logs with Server-Sent Events. Watch logs in
                        real-time as they're ingested.
                    </p>
                    <a href="/docs/api#stream">
                        <Button variant="outline" size="sm" class="gap-1">
                            View Examples
                            <ArrowRight class="w-3 h-3" />
                        </Button>
                    </a>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="flex items-center gap-2">
                        <FileText class="w-5 h-5 text-primary" />
                        Alert System
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p class="text-sm text-muted-foreground mb-3">
                        Create custom alert rules with email and webhook
                        notifications. Stay informed of critical events.
                    </p>
                    <a href="/docs/api#alerts">
                        <Button variant="outline" size="sm" class="gap-1">
                            Setup Alerts
                            <ArrowRight class="w-3 h-3" />
                        </Button>
                    </a>
                </CardContent>
            </Card>
        </div>
    </section>

    <!-- Sample Log Ingestion -->
    <section class="mb-12">
        <h3 id="first-log" class="text-xl font-semibold mb-4 scroll-mt-20">
            Send Your First Log
        </h3>

        <p class="text-muted-foreground mb-4">
            After setting up LogWard, you can start sending logs immediately
            using any HTTP client:
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
      "service": "api-gateway",
      "level": "error",
      "message": "Database connection timeout",
      "metadata": {
        "user_id": 123,
        "endpoint": "/api/users"
      }
    }]
  }'`}
                />
            </div>

            <div>
                <h4 class="text-sm font-semibold mb-2">
                    Self-Hosted (localhost:8080)
                </h4>
                <CodeBlock
                    lang="bash"
                    code={`curl -X POST http://localhost:8080/api/v1/ingest \\
  -H "X-API-Key: lp_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "logs": [{
      "time": "2025-01-23T10:30:00Z",
      "service": "api-gateway",
      "level": "error",
      "message": "Database connection timeout",
      "metadata": {
        "user_id": 123,
        "endpoint": "/api/users"
      }
    }]
  }'`}
                />
            </div>
        </div>
    </section>

    <!-- Navigation -->
    <section>
        <h3 id="next-steps" class="text-xl font-semibold mb-4 scroll-mt-20">
            Next Steps
        </h3>

        <div class="grid gap-4">
            <a href="/docs/getting-started" class="block">
                <Card class="transition-colors hover:border-primary">
                    <CardHeader>
                        <CardTitle class="text-base"
                            >Installation Guide</CardTitle
                        >
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        Detailed setup instructions for development and
                        production
                    </CardContent>
                </Card>
            </a>

            <a href="/docs/api" class="block">
                <Card class="transition-colors hover:border-primary">
                    <CardHeader>
                        <CardTitle class="text-base">API Reference</CardTitle>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        Complete API documentation with examples
                    </CardContent>
                </Card>
            </a>

            <a href="/docs/deployment" class="block">
                <Card class="transition-colors hover:border-primary">
                    <CardHeader>
                        <CardTitle class="text-base">Deployment Guide</CardTitle
                        >
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        Production deployment with Docker, SSL, and best
                        practices
                    </CardContent>
                </Card>
            </a>
        </div>
    </section>
</div>

<style>
    .docs-content :global(h2) {
        @apply border-b border-border pb-2;
    }
</style>
