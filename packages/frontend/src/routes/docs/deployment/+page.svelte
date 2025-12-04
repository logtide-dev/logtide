<script lang="ts">
    import Breadcrumbs from "$lib/components/docs/Breadcrumbs.svelte";
    import CodeBlock from "$lib/components/docs/CodeBlock.svelte";
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { AlertCircle, CheckCircle2, Package, Server } from "lucide-svelte";
</script>

<div class="docs-content">
    <Breadcrumbs />

    <h1 class="text-3xl font-bold mb-4">Deployment Guide</h1>
    <p class="text-lg text-muted-foreground mb-8">
        Deploy LogWard on your infrastructure using pre-built Docker images or build from source.
    </p>

    <h2
        id="pre-built-images"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Pre-built Images (Recommended)
    </h2>

    <div class="mb-12 space-y-6">
        <Card>
            <CardHeader>
                <div class="flex items-start gap-3">
                    <Package class="w-5 h-5 text-primary mt-0.5" />
                    <div>
                        <CardTitle class="text-base">No Build Required</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Use our official pre-built images from Docker Hub or GitHub Container Registry.
                Just download the config, set your passwords, and run.
            </CardContent>
        </Card>

        <div>
            <h3 class="text-lg font-semibold mb-3">Quick Start (2 Minutes)</h3>
            <CodeBlock
                lang="bash"
                code={`# Create project directory
mkdir logward && cd logward

# Download docker-compose.yml
curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/docker-compose.yml

# Download environment template
curl -O https://raw.githubusercontent.com/logward-dev/logward/main/.env.example
mv .env.example .env

# Edit .env with secure passwords
nano .env

# Start LogWard
docker compose up -d`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Required Environment Variables</h3>
            <div class="overflow-x-auto">
                <table class="w-full text-sm border border-border rounded-lg">
                    <thead class="bg-muted">
                        <tr>
                            <th class="text-left p-3 border-b border-border">Variable</th>
                            <th class="text-left p-3 border-b border-border">Description</th>
                            <th class="text-left p-3 border-b border-border">Example</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">DB_PASSWORD</td>
                            <td class="p-3 border-b border-border">PostgreSQL password</td>
                            <td class="p-3 border-b border-border font-mono text-xs">random_secure_password</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">REDIS_PASSWORD</td>
                            <td class="p-3 border-b border-border">Redis password</td>
                            <td class="p-3 border-b border-border font-mono text-xs">another_secure_password</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">API_KEY_SECRET</td>
                            <td class="p-3 border-b border-border">Encryption key (32+ chars)</td>
                            <td class="p-3 border-b border-border font-mono text-xs">your_32_character_secret_key_here</td>
                        </tr>
                        <tr>
                            <td class="p-3 font-mono text-xs">PUBLIC_API_URL</td>
                            <td class="p-3">Backend API URL</td>
                            <td class="p-3 font-mono text-xs">http://localhost:8080</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Available Docker Images</h3>
            <div class="overflow-x-auto">
                <table class="w-full text-sm border border-border rounded-lg">
                    <thead class="bg-muted">
                        <tr>
                            <th class="text-left p-3 border-b border-border">Image</th>
                            <th class="text-left p-3 border-b border-border">Registry</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">logward/backend</td>
                            <td class="p-3 border-b border-border">
                                <a href="https://hub.docker.com/r/logward/backend" class="text-primary hover:underline" target="_blank">Docker Hub</a>
                            </td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">logward/frontend</td>
                            <td class="p-3 border-b border-border">
                                <a href="https://hub.docker.com/r/logward/frontend" class="text-primary hover:underline" target="_blank">Docker Hub</a>
                            </td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">ghcr.io/logward-dev/logward-backend</td>
                            <td class="p-3 border-b border-border">
                                <a href="https://github.com/logward-dev/logward/pkgs/container/logward-backend" class="text-primary hover:underline" target="_blank">GitHub Container Registry</a>
                            </td>
                        </tr>
                        <tr>
                            <td class="p-3 font-mono text-xs">ghcr.io/logward-dev/logward-frontend</td>
                            <td class="p-3">
                                <a href="https://github.com/logward-dev/logward/pkgs/container/logward-frontend" class="text-primary hover:underline" target="_blank">GitHub Container Registry</a>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <Card class="border-yellow-500/30 bg-yellow-500/5">
            <CardHeader>
                <div class="flex items-start gap-3">
                    <AlertCircle class="w-5 h-5 text-yellow-500 mt-0.5" />
                    <div>
                        <CardTitle class="text-base">Production Tip</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p>Always pin to a specific version in production instead of using <code>latest</code>:</p>
                <CodeBlock
                    lang="bash"
                    code={`# In your .env file
LOGWARD_BACKEND_IMAGE=logward/backend:0.2.4
LOGWARD_FRONTEND_IMAGE=logward/frontend:0.2.4`}
                />
            </CardContent>
        </Card>

        <div class="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
            <div class="flex items-start gap-3">
                <CheckCircle2
                    class="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0"
                />
                <div>
                    <p
                        class="font-semibold text-green-600 dark:text-green-400 mb-1"
                    >
                        Ready to Go
                    </p>
                    <p class="text-sm text-muted-foreground">
                        Access LogWard at <code>http://localhost:3000</code> -
                        database migrations run automatically on first start.
                    </p>
                </div>
            </div>
        </div>
    </div>

    <h2
        id="build-from-source"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Build from Source (Alternative)
    </h2>

    <div class="mb-12 space-y-6">
        <Card>
            <CardHeader>
                <div class="flex items-start gap-3">
                    <Server class="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                        <CardTitle class="text-base">For Contributors & Custom Builds</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Build Docker images locally from source code. Useful for development
                or when you need custom modifications.
            </CardContent>
        </Card>

        <div>
            <h3 class="text-lg font-semibold mb-3">Clone and Build</h3>
            <CodeBlock
                lang="bash"
                code={`# Clone the repository
git clone https://github.com/logward-dev/logward.git
cd logward/docker

# Copy environment template
cp ../.env.example .env

# Edit .env with your configuration
nano .env

# Build and start all services
docker compose up -d --build`}
            />
        </div>

        <div class="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
            <div class="flex items-start gap-3">
                <CheckCircle2
                    class="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0"
                />
                <div>
                    <p
                        class="font-semibold text-green-600 dark:text-green-400 mb-1"
                    >
                        Services Running
                    </p>
                    <p class="text-sm text-muted-foreground">
                        Access LogWard at <code>http://your-server-ip:3000</code>
                    </p>
                </div>
            </div>
        </div>
    </div>


    <h2
        id="monitoring"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Monitoring & Maintenance
    </h2>

    <div class="mb-8 space-y-6">
        <div>
            <h3 class="text-lg font-semibold mb-3">Health Checks</h3>
            <CodeBlock
                lang="bash"
                code={`# Check all services status
docker compose ps

# Check backend health
curl http://localhost:8080/health

# Check database
docker compose exec postgres psql -U logward -d logward -c "SELECT COUNT(*) FROM logs;"`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Common Commands</h3>
            <CodeBlock
                lang="bash"
                code={`# Restart a service
docker compose restart backend

# View service logs
docker compose logs --tail=100 -f backend

# Stop all services
docker compose down

# Update to latest version
docker compose pull
docker compose up -d`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Database Backup</h3>
            <CodeBlock
                lang="bash"
                code={`# Create backup
docker compose exec postgres pg_dump -U logward logward > backup_$(date +%Y%m%d).sql

# Restore from backup
docker compose exec -T postgres psql -U logward logward < backup_20250115.sql`}
            />
        </div>
    </div>
</div>

<style>
    .docs-content :global(code:not(pre code)) {
        @apply px-1.5 py-0.5 bg-muted rounded text-sm font-mono;
    }
</style>
