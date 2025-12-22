<script lang="ts">
    import Breadcrumbs from "$lib/components/docs/Breadcrumbs.svelte";
    import CodeBlock from "$lib/components/docs/CodeBlock.svelte";
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { AlertCircle, CheckCircle2, Package, Server, Scale, Layers, Cloud } from "lucide-svelte";
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
            <h3 id="quick-start" class="text-lg font-semibold mb-3 scroll-mt-20">Quick Start (2 Minutes)</h3>
            <CodeBlock
                lang="bash"
                code={`# Create project directory
mkdir logward && cd logward

# Download docker-compose.yml and environment template
curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/docker-compose.yml
curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/.env.example
mv .env.example .env

# Edit .env with secure passwords
nano .env

# Start LogWard
docker compose up -d`}
            />
        </div>

        <div>
            <h3 id="environment-variables" class="text-lg font-semibold mb-3 scroll-mt-20">Required Environment Variables</h3>
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
                            <td class="p-3 font-mono text-xs">API_KEY_SECRET</td>
                            <td class="p-3">Encryption key (32+ chars)</td>
                            <td class="p-3 font-mono text-xs">your_32_character_secret_key_here</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p class="text-sm text-muted-foreground mt-3">
                Database migrations run automatically on first start.
            </p>
        </div>

        <div>
            <h3 id="fluent-bit" class="text-lg font-semibold mb-3 scroll-mt-20">(Optional) Docker Log Collection with Fluent Bit</h3>
            <p class="text-sm text-muted-foreground mb-3">
                To automatically collect logs from all Docker containers using Fluent Bit:
            </p>
            <CodeBlock
                lang="bash"
                code={`# Download Fluent Bit configuration files
curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/fluent-bit.conf
curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/parsers.conf
curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/extract_container_id.lua
curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/wrap_logs.lua

# Add your LogWard API key to .env
echo "FLUENT_BIT_API_KEY=your_api_key_here" >> .env

# Start with logging profile enabled
docker compose --profile logging up -d`}
            />
            <p class="text-sm text-muted-foreground mt-3">
                This profile is optional. Without it, LogWard runs without the Fluent Bit container.
            </p>
        </div>

        <div>
            <h3 id="docker-images" class="text-lg font-semibold mb-3 scroll-mt-20">Available Docker Images</h3>
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
LOGWARD_BACKEND_IMAGE=logward/backend:0.3.2
LOGWARD_FRONTEND_IMAGE=logward/frontend:0.3.2`}
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
                        Frontend: <code>http://localhost:3000</code> | API: <code>http://localhost:8080</code>
                    </p>
                </div>
            </div>
        </div>
    </div>

    <h2
        id="remote-deployment"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Remote Deployment
    </h2>

    <div class="mb-12 space-y-6">
        <Card class="border-green-500/30 bg-green-500/5">
            <CardHeader>
                <div class="flex items-start gap-3">
                    <CheckCircle2 class="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                        <CardTitle class="text-base">Auto-Detection Works in Most Cases</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p class="mb-3">
                    LogWard automatically detects the correct API URL based on how you access the frontend:
                </p>
                <ul class="list-disc list-inside space-y-1">
                    <li><strong>Via IP:3000</strong> (e.g., <code>http://192.168.1.100:3000</code>) → API auto-detected at <code>http://192.168.1.100:8080</code></li>
                    <li><strong>Via domain on port 80/443</strong> (e.g., <code>https://logward.example.com</code>) → Uses relative URLs (assumes reverse proxy)</li>
                </ul>
                <p class="mt-3">
                    No <code>PUBLIC_API_URL</code> configuration needed for these scenarios!
                </p>
            </CardContent>
        </Card>

        <div>
            <h3 id="vps-deployment" class="text-lg font-semibold mb-3 scroll-mt-20">Example: VPS Deployment (No Config Needed)</h3>
            <CodeBlock
                lang="bash"
                code={`# Server IP: 192.168.1.100

# .env configuration - no PUBLIC_API_URL needed!
DB_PASSWORD=secure_password
REDIS_PASSWORD=secure_password
API_KEY_SECRET=your_32_character_secret_key_here

# Access points:
# Frontend: http://192.168.1.100:3000
# API: http://192.168.1.100:8080 (auto-detected)`}
            />
        </div>

        <div>
            <h3 id="reverse-proxy" class="text-lg font-semibold mb-3 scroll-mt-20">With Reverse Proxy (nginx/Traefik)</h3>
            <Card class="border-yellow-500/30 bg-yellow-500/5 mb-4">
                <CardHeader>
                    <div class="flex items-start gap-3">
                        <AlertCircle class="w-5 h-5 text-yellow-500 mt-0.5" />
                        <div>
                            <CardTitle class="text-base">Important: Proxy Both Frontend and API</CardTitle>
                        </div>
                    </div>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    <p>
                        When using a domain (port 80/443), LogWard assumes a reverse proxy is in place and uses relative URLs (<code>/api/v1</code>).
                        Your reverse proxy <strong>must</strong> route both the frontend and the API, otherwise API calls will fail with 404.
                    </p>
                </CardContent>
            </Card>
            <p class="text-sm text-muted-foreground mb-3">
                Example nginx configuration:
            </p>
            <CodeBlock
                lang="nginx"
                code={`server {
    listen 443 ssl;
    server_name logward.example.com;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Backend API - REQUIRED for relative URLs to work
    location /api/ {
        proxy_pass http://localhost:8080/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SSE for live tail (requires special headers)
    location /api/v1/logs/stream {
        proxy_pass http://localhost:8080/api/v1/logs/stream;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
        proxy_buffering off;
        proxy_cache off;
    }
}`}
            />
        </div>

        <div>
            <h3 id="subdomain-api" class="text-lg font-semibold mb-3 scroll-mt-20">Alternative: API on Subdomain</h3>
            <p class="text-sm text-muted-foreground mb-3">
                If you prefer to host the API on a separate subdomain instead of proxying <code>/api/</code>:
            </p>
            <CodeBlock
                lang="bash"
                code={`# .env configuration
PUBLIC_API_URL=https://api.logward.example.com

# Access points:
# Frontend: https://logward.example.com
# API: https://api.logward.example.com`}
            />
        </div>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">Quick Reference: PUBLIC_API_URL</CardTitle>
            </CardHeader>
            <CardContent class="text-sm">
                <div class="overflow-x-auto">
                    <table class="w-full text-sm border border-border rounded-lg">
                        <thead class="bg-muted">
                            <tr>
                                <th class="text-left p-3 border-b border-border">Scenario</th>
                                <th class="text-left p-3 border-b border-border">PUBLIC_API_URL</th>
                                <th class="text-left p-3 border-b border-border">Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="p-3 border-b border-border">Docker via IP:3000</td>
                                <td class="p-3 border-b border-border font-mono text-xs">(not needed)</td>
                                <td class="p-3 border-b border-border text-muted-foreground">Auto-detected → IP:8080</td>
                            </tr>
                            <tr>
                                <td class="p-3 border-b border-border">Domain + reverse proxy</td>
                                <td class="p-3 border-b border-border font-mono text-xs">(not needed)</td>
                                <td class="p-3 border-b border-border text-muted-foreground">Uses /api/v1 (proxy must route it)</td>
                            </tr>
                            <tr>
                                <td class="p-3 border-b border-border">API on subdomain</td>
                                <td class="p-3 border-b border-border font-mono text-xs">https://api.example.com</td>
                                <td class="p-3 border-b border-border text-muted-foreground">Explicit configuration</td>
                            </tr>
                            <tr>
                                <td class="p-3 border-b border-border">Custom port setup</td>
                                <td class="p-3 border-b border-border font-mono text-xs">http://host:custom-port</td>
                                <td class="p-3 border-b border-border text-muted-foreground">When backend is not on :8080</td>
                            </tr>
                            <tr>
                                <td class="p-3">LogWard Cloud</td>
                                <td class="p-3 font-mono text-xs">https://api.logward.dev</td>
                                <td class="p-3 text-muted-foreground">Pre-configured</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    </div>

    <h2
        id="horizontal-scaling"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Horizontal Scaling
    </h2>

    <div class="mb-12 space-y-6">
        <Card>
            <CardHeader>
                <div class="flex items-start gap-3">
                    <Layers class="w-5 h-5 text-primary mt-0.5" />
                    <div>
                        <CardTitle class="text-base">Scale Without Code Changes</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                LogWard is designed for horizontal scaling. Backend and worker services are
                stateless - all state is stored in PostgreSQL and Redis. For high availability,
                use the Traefik overlay to run multiple backend instances behind a load balancer.
            </CardContent>
        </Card>

        <div>
            <h3 id="enable-scaling" class="text-lg font-semibold mb-3 scroll-mt-20">Enable Horizontal Scaling</h3>
            <p class="text-sm text-muted-foreground mb-3">
                The default <code>docker-compose.yml</code> runs a single instance of each service.
                For horizontal scaling, download and use the Traefik overlay:
            </p>
            <CodeBlock
                lang="bash"
                code={`# Download Traefik overlay (adds load balancer)
curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/docker-compose.traefik.yml

# Start with horizontal scaling support
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d

# Scale to 3 backend instances and 2 workers
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --scale backend=3 --scale worker=2

# Check running instances
docker compose ps`}
            />
        </div>

        <Card class="border-yellow-500/30 bg-yellow-500/5">
            <CardHeader>
                <div class="flex items-start gap-3">
                    <AlertCircle class="w-5 h-5 text-yellow-500 mt-0.5" />
                    <div>
                        <CardTitle class="text-base">Traefik Changes Access URLs</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p class="mb-2">
                    When using the Traefik overlay, access changes to a single port:
                </p>
                <ul class="list-disc list-inside space-y-1">
                    <li><strong>With Traefik:</strong> <code>http://localhost:3080</code> (frontend + API on same port)</li>
                    <li><strong>Without Traefik:</strong> Frontend at <code>:3000</code>, API at <code>:8080</code></li>
                </ul>
                <p class="mt-2">
                    The <code>LOGWARD_PORT</code> environment variable controls the Traefik port (default: 3080).
                </p>
            </CardContent>
        </Card>

        <div>
            <h3 id="architecture" class="text-lg font-semibold mb-3 scroll-mt-20">Architecture</h3>
            <div class="overflow-x-auto">
                <table class="w-full text-sm border border-border rounded-lg">
                    <thead class="bg-muted">
                        <tr>
                            <th class="text-left p-3 border-b border-border">Component</th>
                            <th class="text-left p-3 border-b border-border">Default</th>
                            <th class="text-left p-3 border-b border-border">With Traefik</th>
                            <th class="text-left p-3 border-b border-border">Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Traefik</td>
                            <td class="p-3 border-b border-border text-muted-foreground">-</td>
                            <td class="p-3 border-b border-border">1 instance</td>
                            <td class="p-3 border-b border-border">Load balancer, reverse proxy</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Backend</td>
                            <td class="p-3 border-b border-border">1 instance</td>
                            <td class="p-3 border-b border-border">N instances</td>
                            <td class="p-3 border-b border-border">Stateless API servers</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Worker</td>
                            <td class="p-3 border-b border-border">1 instance</td>
                            <td class="p-3 border-b border-border">N instances</td>
                            <td class="p-3 border-b border-border">Background job processors (BullMQ)</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Frontend</td>
                            <td class="p-3 border-b border-border">1 instance</td>
                            <td class="p-3 border-b border-border">N instances</td>
                            <td class="p-3 border-b border-border">SvelteKit SSR</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Redis</td>
                            <td class="p-3 border-b border-border">1 instance</td>
                            <td class="p-3 border-b border-border">1 instance</td>
                            <td class="p-3 border-b border-border">Rate limiting, job queues, cache</td>
                        </tr>
                        <tr>
                            <td class="p-3 font-mono text-xs">PostgreSQL</td>
                            <td class="p-3">1 instance</td>
                            <td class="p-3">1 instance</td>
                            <td class="p-3">TimescaleDB for time-series data</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <Card class="border-blue-500/30 bg-blue-500/5">
            <CardHeader>
                <div class="flex items-start gap-3">
                    <Scale class="w-5 h-5 text-blue-500 mt-0.5" />
                    <div>
                        <CardTitle class="text-base">Why Scaling Works</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <ul class="list-disc list-inside space-y-1">
                    <li><strong>Rate limiting:</strong> Stored in Redis (shared across all backend instances)</li>
                    <li><strong>Sessions:</strong> Stored in Redis (no sticky sessions required)</li>
                    <li><strong>Job queues:</strong> BullMQ distributes work across all workers automatically</li>
                    <li><strong>Health checks:</strong> Traefik removes unhealthy instances from rotation</li>
                </ul>
            </CardContent>
        </Card>
    </div>

    <h2
        id="kubernetes"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Kubernetes (Helm)
    </h2>

    <div class="mb-12 space-y-6">
        <Card>
            <CardHeader>
                <div class="flex items-start gap-3">
                    <Cloud class="w-5 h-5 text-primary mt-0.5" />
                    <div>
                        <CardTitle class="text-base">Production-Ready Kubernetes Deployment</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                Deploy LogWard on any Kubernetes cluster using our official Helm chart.
                Includes auto-scaling, health probes, Ingress support, and Prometheus monitoring.
            </CardContent>
        </Card>

        <div>
            <h3 id="helm-quick-install" class="text-lg font-semibold mb-3 scroll-mt-20">Quick Install</h3>
            <CodeBlock
                lang="bash"
                code={`# Add the LogWard Helm repository
helm repo add logward https://logward-dev.github.io/logward-helm-chart
helm repo update

# Install LogWard
helm install logward logward/logward \\
  --namespace logward \\
  --create-namespace \\
  --set timescaledb.auth.password=<your-db-password> \\
  --set redis.auth.password=<your-redis-password>`}
            />
        </div>

        <div>
            <h3 id="helm-whats-included" class="text-lg font-semibold mb-3 scroll-mt-20">What's Included</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                    <CardContent class="pt-4">
                        <ul class="text-sm space-y-2">
                            <li class="flex items-center gap-2">
                                <CheckCircle2 class="w-4 h-4 text-green-500" />
                                <span>Backend API (2+ replicas)</span>
                            </li>
                            <li class="flex items-center gap-2">
                                <CheckCircle2 class="w-4 h-4 text-green-500" />
                                <span>Frontend (2+ replicas)</span>
                            </li>
                            <li class="flex items-center gap-2">
                                <CheckCircle2 class="w-4 h-4 text-green-500" />
                                <span>Worker (BullMQ jobs)</span>
                            </li>
                            <li class="flex items-center gap-2">
                                <CheckCircle2 class="w-4 h-4 text-green-500" />
                                <span>TimescaleDB StatefulSet</span>
                            </li>
                        </ul>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent class="pt-4">
                        <ul class="text-sm space-y-2">
                            <li class="flex items-center gap-2">
                                <CheckCircle2 class="w-4 h-4 text-green-500" />
                                <span>Redis StatefulSet</span>
                            </li>
                            <li class="flex items-center gap-2">
                                <CheckCircle2 class="w-4 h-4 text-green-500" />
                                <span>Horizontal Pod Autoscaler</span>
                            </li>
                            <li class="flex items-center gap-2">
                                <CheckCircle2 class="w-4 h-4 text-green-500" />
                                <span>Ingress (nginx, ALB, etc.)</span>
                            </li>
                            <li class="flex items-center gap-2">
                                <CheckCircle2 class="w-4 h-4 text-green-500" />
                                <span>ServiceMonitor (Prometheus)</span>
                            </li>
                        </ul>
                    </CardContent>
                </Card>
            </div>
        </div>

        <div>
            <h3 id="helm-ingress" class="text-lg font-semibold mb-3 scroll-mt-20">Enable Ingress</h3>
            <CodeBlock
                lang="bash"
                code={`helm install logward logward/logward \\
  --namespace logward \\
  --create-namespace \\
  --set timescaledb.auth.password=<password> \\
  --set redis.auth.password=<password> \\
  --set ingress.enabled=true \\
  --set ingress.className=nginx \\
  --set ingress.hosts[0].host=logward.example.com \\
  --set ingress.hosts[0].paths[0].path=/ \\
  --set ingress.hosts[0].paths[0].pathType=Prefix \\
  --set ingress.hosts[0].paths[0].service=frontend`}
            />
        </div>

        <div>
            <h3 id="external-database" class="text-lg font-semibold mb-3 scroll-mt-20">Use External Database</h3>
            <p class="text-sm text-muted-foreground mb-3">
                For production, you can use an external managed database (AWS RDS, Cloud SQL, etc.):
            </p>
            <CodeBlock
                lang="bash"
                code={`helm install logward logward/logward \\
  --namespace logward \\
  --create-namespace \\
  --set timescaledb.enabled=false \\
  --set externalDatabase.host=your-db.region.rds.amazonaws.com \\
  --set externalDatabase.port=5432 \\
  --set externalDatabase.database=logward \\
  --set externalDatabase.username=logward \\
  --set externalDatabase.password=<password> \\
  --set redis.auth.password=<password>`}
            />
        </div>

        <div>
            <h3 id="cloud-examples" class="text-lg font-semibold mb-3 scroll-mt-20">Cloud-Specific Examples</h3>
            <div class="space-y-4">
                <div>
                    <p class="text-sm font-medium mb-2">AWS EKS</p>
                    <CodeBlock
                        lang="yaml"
                        code={`# values-eks.yaml
global:
  storageClass: gp3

ingress:
  enabled: true
  className: alb
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip`}
                    />
                </div>
                <div>
                    <p class="text-sm font-medium mb-2">GCP GKE</p>
                    <CodeBlock
                        lang="yaml"
                        code={`# values-gke.yaml
global:
  storageClass: standard-rwo

ingress:
  enabled: true
  className: gce`}
                    />
                </div>
            </div>
        </div>

        <Card class="border-blue-500/30 bg-blue-500/5">
            <CardHeader>
                <div class="flex items-start gap-3">
                    <Package class="w-5 h-5 text-blue-500 mt-0.5" />
                    <div>
                        <CardTitle class="text-base">Helm Chart Resources</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <ul class="space-y-2">
                    <li>
                        <a href="https://artifacthub.io/packages/helm/logward/logward" class="text-primary hover:underline" target="_blank">
                            Artifact Hub →
                        </a>
                        <span class="text-muted-foreground ml-1">Browse chart versions and values</span>
                    </li>
                    <li>
                        <a href="https://github.com/logward-dev/logward-helm-chart" class="text-primary hover:underline" target="_blank">
                            GitHub Repository →
                        </a>
                        <span class="text-muted-foreground ml-1">Source code and issues</span>
                    </li>
                </ul>
            </CardContent>
        </Card>
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
            <h3 id="clone-build" class="text-lg font-semibold mb-3 scroll-mt-20">Clone and Build</h3>
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
            <h3 id="health-checks" class="text-lg font-semibold mb-3 scroll-mt-20">Health Checks</h3>
            <CodeBlock
                lang="bash"
                code={`# Check all services status
docker compose ps

# Check backend health
curl http://localhost:8080/health

# With Traefik overlay
curl http://localhost:3080/health

# Check database
docker compose exec postgres psql -U logward -d logward -c "SELECT COUNT(*) FROM logs;"`}
            />
        </div>

        <div>
            <h3 id="common-commands" class="text-lg font-semibold mb-3 scroll-mt-20">Common Commands</h3>
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
            <h3 id="database-backup" class="text-lg font-semibold mb-3 scroll-mt-20">Database Backup</h3>
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
