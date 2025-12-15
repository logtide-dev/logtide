<script lang="ts">
  import { onMount } from 'svelte';
  import { authStore } from '$lib/stores/auth';
  import Button from '$lib/components/ui/button/button.svelte';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Shield from '@lucide/svelte/icons/shield';
  import Zap from '@lucide/svelte/icons/zap';
  import Search from '@lucide/svelte/icons/search';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Github from '@lucide/svelte/icons/github';
  import Activity from '@lucide/svelte/icons/activity';
  import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
  import Server from '@lucide/svelte/icons/server';
  import TrendingUp from '@lucide/svelte/icons/trending-up';
  import Download from '@lucide/svelte/icons/download';
  import Key from '@lucide/svelte/icons/key';
  import Send from '@lucide/svelte/icons/send';
  import Bell from '@lucide/svelte/icons/bell';
  import Lock from '@lucide/svelte/icons/lock';
  import Gauge from '@lucide/svelte/icons/gauge';
  import Euro from '@lucide/svelte/icons/euro';
  import { logoPath } from '$lib/utils/theme';

  let isAuthenticated = $state(false);
  let checkingAuth = $state(true);

  onMount(() => {
    const unsubscribe = authStore.subscribe((state) => {
      isAuthenticated = !!state.token;
      checkingAuth = false;
    });
    return unsubscribe;
  });

  const features = [
    {
      icon: Lock,
      title: 'GDPR Compliant',
      description: 'Keep logs on your servers or use our EU-based cloud. Full data ownership and privacy control.'
    },
    {
      icon: Gauge,
      title: 'Lightweight',
      description: 'Built on TimescaleDB & Fastify. Lower memory footprint compared to Java-based stacks like ELK.'
    },
    {
      icon: Shield,
      title: 'Security Built-in',
      description: 'Sigma rules engine for threat detection. Turn your logs into a SIEM without extra tools.'
    },
    {
      icon: GitBranch,
      title: 'OpenTelemetry Native',
      description: 'OTLP ingestion for logs and traces. Distributed tracing with service dependency graphs.'
    }
  ];

  const steps = [
    {
      icon: Download,
      title: 'Deploy in 5 minutes',
      description: 'Self-host with Docker Compose or sign up for the free cloud. No complex infrastructure required.'
    },
    {
      icon: Key,
      title: 'Get your API key',
      description: 'Create an organization and project. Generate a scoped API key for your application.'
    },
    {
      icon: Send,
      title: 'Send your logs',
      description: 'Use our SDKs (Node.js, Python, PHP, Kotlin), OpenTelemetry, or the HTTP API directly.'
    },
    {
      icon: Bell,
      title: 'Search & Alert',
      description: 'Full-text search, real-time streaming, and alerts via Email, Slack, or Discord webhooks.'
    }
  ];

  // Mock data for the dashboard preview
  const mockStats = [
    { label: 'Total Logs Today', value: '1.2M', trend: '+12%', icon: Activity, positive: true },
    { label: 'Error Rate', value: '0.3%', trend: '-5%', icon: AlertTriangle, positive: true },
    { label: 'Active Services', value: '24', trend: '+2', icon: Server, positive: true },
    { label: 'Throughput', value: '850/s', trend: '+8%', icon: TrendingUp, positive: true },
  ];

  const mockLogs = [
    { time: '14:23:45', service: 'api-gateway', level: 'info', message: 'Request processed successfully' },
    { time: '14:23:44', service: 'auth-service', level: 'warn', message: 'Rate limit approaching threshold' },
    { time: '14:23:42', service: 'payment-svc', level: 'error', message: 'Connection timeout to payment provider' },
    { time: '14:23:41', service: 'api-gateway', level: 'info', message: 'Health check passed' },
    { time: '14:23:40', service: 'user-service', level: 'debug', message: 'Cache hit for user profile' },
  ];

  function getLevelColor(level: string) {
    switch (level) {
      case 'error': return 'bg-red-500/20 text-red-400';
      case 'warn': return 'bg-yellow-500/20 text-yellow-400';
      case 'info': return 'bg-blue-500/20 text-blue-400';
      case 'debug': return 'bg-gray-500/20 text-gray-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  }
</script>

<svelte:head>
  <title>LogWard - Privacy-first Log Management. Open Source.</title>
  <meta name="description" content="Open source alternative to Datadog and Splunk. GDPR compliant, self-hosted log management with Sigma rules for threat detection. Built in Europe." />
</svelte:head>

<div class="min-h-screen bg-background overflow-hidden">
  <header class="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
    <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2">
        <img src={$logoPath} alt="LogWard" class="h-8 w-auto" />
      </a>

      <nav class="hidden md:flex items-center gap-6">
        <a href="/docs" class="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Docs
        </a>
        <a href="https://github.com/logward-dev/logward" target="_blank" rel="noopener noreferrer" class="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1" aria-label="View LogWard on GitHub (opens in new tab)">
          <Github class="w-4 h-4" aria-hidden="true" />
          GitHub
        </a>
      </nav>

      <div class="flex items-center gap-3">
        {#if checkingAuth}
          <div class="w-20 h-9 bg-muted animate-pulse rounded-md" aria-hidden="true"></div>
        {:else if isAuthenticated}
          <Button href="/dashboard">
            Dashboard
            <ArrowRight class="w-4 h-4 ml-1" />
          </Button>
        {:else}
          <Button variant="ghost" href="/login">
            Login
          </Button>
          <Button href="/register">
            Get Started
            <ArrowRight class="w-4 h-4 ml-1" />
          </Button>
        {/if}
      </div>
    </div>
  </header>

  <main>
  <section class="relative py-16 md:py-24 px-6" aria-labelledby="hero-heading">
    <div class="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" aria-hidden="true"></div>
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent pointer-events-none" aria-hidden="true"></div>

    <div class="max-w-6xl mx-auto relative">
      <div class="text-center mb-12">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
          <span class="relative flex h-2 w-2" aria-hidden="true">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          Free during Alpha
        </div>

        <h1 id="hero-heading" class="text-4xl md:text-6xl font-bold tracking-tight mb-6">
          Privacy-first Log Management.
          <span class="text-primary">Open Source.</span>
        </h1>

        <p class="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
          The open source alternative to Datadog and Splunk.
          GDPR compliant, self-hosted or EU cloud. No ElasticSearch complexity.
        </p>

        <div class="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
          {#if isAuthenticated}
            <Button size="lg" href="/dashboard">
              Go to Dashboard
              <ArrowRight class="w-5 h-5 ml-2" />
            </Button>
          {:else}
            <Button size="lg" href="/register">
              Try Cloud Free
              <ArrowRight class="w-5 h-5 ml-2" />
            </Button>
          {/if}
          <Button size="lg" variant="outline" href="/docs/getting-started">
            Self-Host with Docker
          </Button>
        </div>
      </div>

      <figure class="relative mx-auto max-w-5xl" role="img" aria-label="LogWard dashboard preview showing log statistics, volume chart, and recent logs table">
        <div class="absolute -inset-4 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 rounded-2xl blur-2xl opacity-50" aria-hidden="true"></div>

        <div class="relative rounded-xl border border-border bg-card shadow-2xl overflow-hidden" aria-hidden="true">
          <div class="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/50">
            <div class="flex gap-1.5">
              <div class="w-3 h-3 rounded-full bg-red-500/80"></div>
              <div class="w-3 h-3 rounded-full bg-yellow-500/80"></div>
              <div class="w-3 h-3 rounded-full bg-green-500/80"></div>
            </div>
            <div class="flex-1 flex justify-center">
              <div class="px-4 py-1 rounded-md bg-background/50 text-xs text-muted-foreground font-mono">
                logward.dev/dashboard
              </div>
            </div>
            <div class="w-16"></div>
          </div>

          <div class="p-4 md:p-6 bg-background">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
              {#each mockStats as stat}
                {@const Icon = stat.icon}
                <div class="p-3 md:p-4 rounded-lg border border-border bg-card">
                  <div class="flex items-center gap-2 text-muted-foreground mb-1">
                    <Icon class="w-4 h-4" />
                    <span class="text-xs truncate">{stat.label}</span>
                  </div>
                  <div class="flex items-baseline gap-2">
                    <span class="text-xl md:text-2xl font-bold">{stat.value}</span>
                    <span class="text-xs {stat.positive ? 'text-green-500' : 'text-red-500'}">{stat.trend}</span>
                  </div>
                </div>
              {/each}
            </div>

            <div class="rounded-lg border border-border bg-card p-4 mb-6">
              <div class="flex items-center justify-between mb-4">
                <span class="font-medium text-sm">Log Volume (24h)</span>
                <div class="flex gap-2">
                  <span class="px-2 py-0.5 rounded text-xs bg-primary/10 text-primary">Live</span>
                </div>
              </div>
              <div class="flex items-end gap-1 h-24" role="img" aria-label="Bar chart showing log volume over 24 hours">
                {#each [40, 55, 45, 60, 50, 70, 65, 80, 75, 90, 85, 95, 88, 92, 78, 82, 70, 65, 75, 80, 85, 90, 88, 95] as height, i}
                  <div
                    class="flex-1 rounded-t transition-all duration-300 {i >= 22 ? 'bg-primary' : 'bg-primary/30'}"
                    style="height: {height}%"
                  ></div>
                {/each}
              </div>
              <div class="flex justify-between mt-2 text-xs text-muted-foreground">
                <span>00:00</span>
                <span>12:00</span>
                <span>Now</span>
              </div>
            </div>

            <div class="rounded-lg border border-border bg-card overflow-hidden">
              <div class="px-4 py-3 border-b border-border flex items-center justify-between">
                <span class="font-medium text-sm">Recent Logs</span>
                <span class="text-xs text-muted-foreground">Last 5 entries</span>
              </div>
              <div class="divide-y divide-border">
                {#each mockLogs as log}
                  <div class="px-4 py-2 flex items-center gap-3 text-sm hover:bg-muted/30 transition-colors">
                    <span class="font-mono text-xs text-muted-foreground w-16 shrink-0">{log.time}</span>
                    <span class="px-2 py-0.5 rounded text-xs font-medium bg-secondary truncate max-w-20">{log.service}</span>
                    <span class="px-2 py-0.5 rounded text-xs font-medium uppercase w-14 text-center shrink-0 {getLevelColor(log.level)}">{log.level}</span>
                    <span class="text-muted-foreground truncate flex-1">{log.message}</span>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        </div>
      </figure>
    </div>
  </section>

  <section class="py-24 px-6 relative overflow-hidden" aria-labelledby="why-logward-heading">
    <div class="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" aria-hidden="true"></div>
    <div class="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" aria-hidden="true"></div>
    <div class="absolute bottom-0 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" aria-hidden="true"></div>

    <div class="max-w-6xl mx-auto relative">
      <div class="text-center mb-16">
        <span class="text-primary font-medium text-sm uppercase tracking-wider">Why Choose Us</span>
        <h2 id="why-logward-heading" class="text-3xl md:text-4xl font-bold mt-2 mb-4">Built Different</h2>
        <p class="text-muted-foreground max-w-2xl mx-auto text-lg">
          For developers and European SMBs who need data ownership
          without ElasticSearch complexity.
        </p>
      </div>

      <div class="grid md:grid-cols-2 gap-6">
        {#each features as feature, i}
          {@const Icon = feature.icon}
          <article class="group p-8 rounded-2xl border border-border bg-card/80 backdrop-blur-sm hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300">
            <div class="flex items-start gap-5">
              <div class="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform" aria-hidden="true">
                <Icon class="w-7 h-7 text-primary" />
              </div>
              <div>
                <h3 class="text-xl font-semibold mb-2">{feature.title}</h3>
                <p class="text-muted-foreground">{feature.description}</p>
              </div>
            </div>
          </article>
        {/each}
      </div>
    </div>
  </section>

  <section class="py-24 px-6 bg-muted/30" aria-labelledby="quickstart-heading">
    <div class="max-w-6xl mx-auto">
      <div class="grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <span class="text-primary font-medium text-sm uppercase tracking-wider">Quick Start</span>
          <h2 id="quickstart-heading" class="text-3xl md:text-4xl font-bold mt-2 mb-4">Get started in minutes</h2>
          <p class="text-muted-foreground mb-10 text-lg">
            From zero to production-ready log management.
          </p>

          <ol class="space-y-6 list-none p-0 m-0">
            {#each steps as step, i}
              {@const Icon = step.icon}
              <li class="flex items-start gap-4">
                <span class="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 font-bold" aria-hidden="true">
                  {i + 1}
                </span>
                <div class="pt-1">
                  <h3 class="font-semibold mb-1">{step.title}</h3>
                  <p class="text-sm text-muted-foreground">{step.description}</p>
                </div>
              </li>
            {/each}
          </ol>
        </div>

        <figure class="relative" aria-label="Code example showing how to use the LogWard SDK">
          <div class="absolute -inset-4 bg-gradient-to-r from-primary/10 to-primary/5 rounded-2xl blur-xl" aria-hidden="true"></div>
          <div class="relative rounded-xl border border-border bg-[#0d1117] shadow-2xl overflow-hidden">
            <div class="flex items-center gap-2 px-4 py-3 bg-[#161b22] border-b border-[#30363d]" aria-hidden="true">
              <div class="flex gap-1.5">
                <div class="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
                <div class="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
                <div class="w-3 h-3 rounded-full bg-[#27c93f]"></div>
              </div>
              <span class="text-xs text-[#8b949e] ml-2 font-mono">app.ts</span>
            </div>
            <pre class="p-5 font-mono text-sm leading-relaxed overflow-x-auto m-0" role="code" aria-label="TypeScript code example"><code><div class="text-[#8b949e]">// Install: npm install @logward/sdk</div>
<div class="mt-3"><span class="text-[#ff7b72]">import</span><span class="text-[#c9d1d9]"> {'{'} LogWard {'}'} </span><span class="text-[#ff7b72]">from</span><span class="text-[#a5d6ff]"> '@logward/sdk'</span></div>
<div class="mt-4"><span class="text-[#ff7b72]">const</span><span class="text-[#c9d1d9]"> logger = </span><span class="text-[#ff7b72]">new</span><span class="text-[#d2a8ff]"> LogWard</span><span class="text-[#c9d1d9]">({'{'}</span></div>
<div class="text-[#c9d1d9] pl-4">apiKey: <span class="text-[#a5d6ff]">'lw_xxxx'</span>,</div>
<div class="text-[#c9d1d9] pl-4">service: <span class="text-[#a5d6ff]">'my-api'</span></div>
<div class="text-[#c9d1d9]">{'}'})</div>
<div class="mt-4"><span class="text-[#c9d1d9]">logger.</span><span class="text-[#d2a8ff]">info</span><span class="text-[#c9d1d9]">(</span><span class="text-[#a5d6ff]">'User signed up'</span><span class="text-[#c9d1d9]">, {'{'}</span></div>
<div class="text-[#c9d1d9] pl-4">userId: <span class="text-[#a5d6ff]">'usr_123'</span>,</div>
<div class="text-[#c9d1d9] pl-4">plan: <span class="text-[#a5d6ff]">'pro'</span></div>
<div class="text-[#c9d1d9]">{'}'})</div></code></pre>
          </div>
        </figure>
      </div>
    </div>
  </section>

  <section class="py-24 px-6" aria-labelledby="sdks-heading">
    <div class="max-w-6xl mx-auto">
      <div class="text-center mb-12">
        <span class="text-primary font-medium text-sm uppercase tracking-wider">Integrations</span>
        <h2 id="sdks-heading" class="text-3xl md:text-4xl font-bold mt-2 mb-4">Works with your stack</h2>
        <p class="text-muted-foreground text-lg max-w-2xl mx-auto">
          Native SDKs with retry logic and circuit breakers. Or use OpenTelemetry.
        </p>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <a href="/docs/sdks/nodejs" class="group p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-card/80 transition-all text-center">
          <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg" alt="Node.js" class="w-12 h-12 mx-auto mb-3 group-hover:scale-110 transition-transform" />
          <span class="font-medium">Node.js</span>
          <div class="text-xs text-muted-foreground mt-1">npm install</div>
        </a>
        <a href="/docs/sdks/python" class="group p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-card/80 transition-all text-center">
          <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg" alt="Python" class="w-12 h-12 mx-auto mb-3 group-hover:scale-110 transition-transform" />
          <span class="font-medium">Python</span>
          <div class="text-xs text-muted-foreground mt-1">pip install</div>
        </a>
        <a href="/docs/sdks/go" class="group p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-card/80 transition-all text-center">
          <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/go/go-original-wordmark.svg" alt="Go" class="w-12 h-12 mx-auto mb-3 group-hover:scale-110 transition-transform" />
          <span class="font-medium">Go</span>
          <div class="text-xs text-muted-foreground mt-1">go get</div>
        </a>
        <a href="/docs/sdks/php" class="group p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-card/80 transition-all text-center">
          <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/php/php-original.svg" alt="PHP" class="w-12 h-12 mx-auto mb-3 group-hover:scale-110 transition-transform" />
          <span class="font-medium">PHP</span>
          <div class="text-xs text-muted-foreground mt-1">composer</div>
        </a>
        <a href="/docs/sdks/kotlin" class="group p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-card/80 transition-all text-center">
          <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/kotlin/kotlin-original.svg" alt="Kotlin" class="w-12 h-12 mx-auto mb-3 group-hover:scale-110 transition-transform" />
          <span class="font-medium">Kotlin</span>
          <div class="text-xs text-muted-foreground mt-1">gradle</div>
        </a>
        <a href="/docs/sdks/csharp" class="group p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-card/80 transition-all text-center">
          <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/csharp/csharp-original.svg" alt="C#" class="w-12 h-12 mx-auto mb-3 group-hover:scale-110 transition-transform" />
          <span class="font-medium">C# / .NET</span>
          <div class="text-xs text-muted-foreground mt-1">dotnet add</div>
        </a>
        <a href="/docs/opentelemetry" class="group p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-card/80 transition-all text-center">
          <div class="w-12 h-12 mx-auto mb-3 rounded-lg bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform" aria-hidden="true">
            <GitBranch class="w-7 h-7 text-primary" />
          </div>
          <span class="font-medium">OpenTelemetry</span>
          <div class="text-xs text-muted-foreground mt-1">OTLP native</div>
        </a>
      </div>
    </div>
  </section>

  <section class="py-24 px-6 relative overflow-hidden" aria-labelledby="cta-heading">
    <div class="absolute inset-0 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent" aria-hidden="true"></div>
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/20 rounded-full blur-3xl opacity-30" aria-hidden="true"></div>

    <div class="max-w-4xl mx-auto text-center relative">
      <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
          Now in Alpha & Free
      </div>

      <h2 id="cta-heading" class="text-3xl md:text-5xl font-bold mb-6">Ready to own your logs?</h2>
      <p class="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
        Start with the free cloud or deploy on your own infrastructure.
        No vendor lock-in. Export anytime.
      </p>

      <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
        {#if isAuthenticated}
          <Button size="lg" class="text-lg px-8 py-6" href="/dashboard">
            Go to Dashboard
            <ArrowRight class="w-5 h-5 ml-2" />
          </Button>
        {:else}
          <Button size="lg" class="text-lg px-8 py-6" href="/register">
            Start Free Trial
            <ArrowRight class="w-5 h-5 ml-2" />
          </Button>
        {/if}
        <Button size="lg" variant="outline" class="text-lg px-8 py-6" href="https://github.com/logward-dev/logward" target="_blank" aria-label="Star LogWard on GitHub (opens in new tab)">
          <Github class="w-5 h-5 mr-2" aria-hidden="true" />
          Star on GitHub
        </Button>
      </div>

      <p class="text-sm text-muted-foreground mt-8">
        Join 50+ companies already using LogWard
      </p>
    </div>
  </section>
  </main>

  <footer class="py-12 px-6 border-t border-border bg-card/30">
    <div class="max-w-6xl mx-auto">
      <div class="grid md:grid-cols-4 gap-8 mb-8">
        <div class="md:col-span-2">
          <img src={$logoPath} alt="LogWard" class="h-8 w-auto mb-4" />
          <p class="text-sm text-muted-foreground max-w-xs">
            Privacy-first log management. Open source, GDPR compliant, built in Europe.
          </p>
        </div>

        <nav aria-label="Product links">
          <h4 class="font-semibold mb-4">Product</h4>
          <ul class="space-y-2">
            <li><a href="/docs" class="text-sm text-muted-foreground hover:text-foreground transition-colors">Documentation</a></li>
            <li><a href="/docs/getting-started" class="text-sm text-muted-foreground hover:text-foreground transition-colors">Getting Started</a></li>
            <li><a href="/docs/sdks" class="text-sm text-muted-foreground hover:text-foreground transition-colors">SDKs</a></li>
          </ul>
        </nav>

        <nav aria-label="Open source links">
          <h4 class="font-semibold mb-4">Open Source</h4>
          <ul class="space-y-2">
            <li><a href="https://github.com/logward-dev/logward" target="_blank" rel="noopener noreferrer" class="text-sm text-muted-foreground hover:text-foreground transition-colors">GitHub</a></li>
            <li><a href="https://github.com/logward-dev/logward/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" class="text-sm text-muted-foreground hover:text-foreground transition-colors">AGPLv3 License</a></li>
            <li><a href="https://github.com/logward-dev/logward/issues" target="_blank" rel="noopener noreferrer" class="text-sm text-muted-foreground hover:text-foreground transition-colors">Report Issue</a></li>
          </ul>
        </nav>
      </div>

      <div class="pt-8 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4">
        <p class="text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} LogWard. Built with care in Europe.
        </p>
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <span class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-green-500" aria-hidden="true"></span>
            <span role="status">All systems operational</span>
          </span>
        </div>
      </div>
    </div>
  </footer>
</div>
