<script lang="ts">
    import Breadcrumbs from "$lib/components/docs/Breadcrumbs.svelte";
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
        CardDescription,
    } from "$lib/components/ui/card";
    import { Badge } from "$lib/components/ui/badge";
    import { Check, ArrowRight, DollarSign, Shield, Zap, Users } from "lucide-svelte";

    const migrations = [
        {
            name: "Datadog",
            slug: "datadog",
            difficulty: "Medium",
            estimatedTime: "4-8 hours",
            description: "Migrate from Datadog's proprietary platform to LogWard and save up to 90% on log costs.",
            highlights: ["No per-GB pricing", "Self-hosted", "Full SIEM included"]
        },
        {
            name: "Splunk",
            slug: "splunk",
            difficulty: "Medium",
            estimatedTime: "6-12 hours",
            description: "Replace Splunk Universal Forwarder with LogWard's lightweight SDK and native Sigma rules.",
            highlights: ["SPL to LogWard query mapping", "Sigma rules support", "No license fees"]
        },
        {
            name: "ELK Stack",
            slug: "elk",
            difficulty: "Easy",
            estimatedTime: "3-6 hours",
            description: "Simplify your ELK (Elasticsearch, Logstash, Kibana) stack with LogWard's all-in-one solution.",
            highlights: ["No cluster management", "Built-in SIEM", "Similar query syntax"]
        },
        {
            name: "SigNoz",
            slug: "signoz",
            difficulty: "Easy",
            estimatedTime: "2-4 hours",
            description: "Seamless migration from SigNoz with native OpenTelemetry support and enhanced security features.",
            highlights: ["OpenTelemetry native", "Sigma detection", "MITRE ATT&CK mapping"]
        },
        {
            name: "Grafana Loki",
            slug: "loki",
            difficulty: "Easy",
            estimatedTime: "4-6 hours",
            description: "Move from Loki to LogWard for built-in alerting, SIEM capabilities, and richer querying.",
            highlights: ["Built-in alerting", "No Prometheus dependency", "Full-text search"]
        }
    ];

    const benefits = [
        {
            icon: DollarSign,
            title: "Zero Per-GB Costs",
            description: "Self-hosted means unlimited logs without metered pricing. Only pay for infrastructure."
        },
        {
            icon: Shield,
            title: "Full Data Ownership",
            description: "Your logs never leave your infrastructure. GDPR compliant by design with EU data sovereignty."
        },
        {
            icon: Zap,
            title: "Built-in SIEM",
            description: "Sigma rules, threat detection, and incident management included - no extra costs or add-ons."
        },
        {
            icon: Users,
            title: "Unlimited Users",
            description: "No per-seat licensing. Add your entire team without worrying about costs."
        }
    ];

    function getDifficultyColor(difficulty: string): string {
        switch (difficulty) {
            case "Easy": return "bg-green-500/10 text-green-600 border-green-500/20";
            case "Medium": return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
            case "Advanced": return "bg-red-500/10 text-red-600 border-red-500/20";
            default: return "";
        }
    }
</script>

<div class="docs-content">
    <Breadcrumbs />

    <h1 class="text-3xl font-bold mb-4">Migration Guides</h1>
    <p class="text-lg text-muted-foreground mb-8">
        Step-by-step guides to migrate from your current log management platform to LogWard.
        Each guide includes feature comparisons, SDK migration examples, and alert conversion strategies.
    </p>

    <h2
        id="why-migrate"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Why Migrate to LogWard?
    </h2>

    <div class="mb-8 grid md:grid-cols-2 gap-4">
        {#each benefits as benefit}
            <Card>
                <CardContent class="pt-4 flex items-start gap-3">
                    <div class="p-2 rounded-lg bg-primary/10">
                        <svelte:component this={benefit.icon} class="w-5 h-5 text-primary" />
                    </div>
                    <div>
                        <h3 class="font-semibold mb-1">{benefit.title}</h3>
                        <p class="text-sm text-muted-foreground">{benefit.description}</p>
                    </div>
                </CardContent>
            </Card>
        {/each}
    </div>

    <h2
        id="migration-guides"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Choose Your Migration Path
    </h2>

    <div class="mb-8 grid gap-4">
        {#each migrations as migration}
            <a href="/docs/migration/{migration.slug}" class="block group">
                <Card class="transition-all hover:border-primary/50 hover:shadow-md">
                    <CardHeader class="pb-2">
                        <div class="flex items-center justify-between">
                            <CardTitle class="text-xl group-hover:text-primary transition-colors">
                                {migration.name} <ArrowRight class="inline w-4 h-4 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </CardTitle>
                            <div class="flex items-center gap-2">
                                <Badge variant="outline" class={getDifficultyColor(migration.difficulty)}>
                                    {migration.difficulty}
                                </Badge>
                                <Badge variant="secondary">
                                    {migration.estimatedTime}
                                </Badge>
                            </div>
                        </div>
                        <CardDescription>{migration.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div class="flex flex-wrap gap-2">
                            {#each migration.highlights as highlight}
                                <span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                    <Check class="w-3 h-3 text-green-500" />
                                    {highlight}
                                </span>
                            {/each}
                        </div>
                    </CardContent>
                </Card>
            </a>
        {/each}
    </div>

    <h2
        id="migration-process"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        General Migration Process
    </h2>

    <div class="mb-8">
        <p class="mb-4">
            While each platform has unique considerations, all migrations follow a similar process:
        </p>

        <div class="space-y-4">
            <Card>
                <CardContent class="pt-4">
                    <div class="flex items-start gap-4">
                        <div class="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                            1
                        </div>
                        <div>
                            <h3 id="preparation-assessment" class="font-semibold mb-1 scroll-mt-20">Preparation & Assessment</h3>
                            <p class="text-sm text-muted-foreground">
                                Document your current setup: log sources, volume, alerts, dashboards, and integrations.
                                Export configurations where possible.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent class="pt-4">
                    <div class="flex items-start gap-4">
                        <div class="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                            2
                        </div>
                        <div>
                            <h3 id="deploy-logward" class="font-semibold mb-1 scroll-mt-20">Deploy LogWard</h3>
                            <p class="text-sm text-muted-foreground">
                                Set up LogWard using Docker Compose. Create your organization, project, and generate an API key.
                                See the <a href="/docs/deployment" class="text-primary hover:underline">Deployment Guide</a> for details.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent class="pt-4">
                    <div class="flex items-start gap-4">
                        <div class="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                            3
                        </div>
                        <div>
                            <h3 id="parallel-ingestion" class="font-semibold mb-1 scroll-mt-20">Parallel Ingestion</h3>
                            <p class="text-sm text-muted-foreground">
                                Configure your application to send logs to both platforms simultaneously.
                                Run in parallel for 24-48 hours to validate data consistency.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent class="pt-4">
                    <div class="flex items-start gap-4">
                        <div class="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                            4
                        </div>
                        <div>
                            <h3 id="migrate-alerts-dashboards" class="font-semibold mb-1 scroll-mt-20">Migrate Alerts & Dashboards</h3>
                            <p class="text-sm text-muted-foreground">
                                Convert your alert rules to LogWard's format. Recreate critical dashboards.
                                Test notifications (email, Slack, webhooks).
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent class="pt-4">
                    <div class="flex items-start gap-4">
                        <div class="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                            5
                        </div>
                        <div>
                            <h3 id="cutover-cleanup" class="font-semibold mb-1 scroll-mt-20">Cutover & Cleanup</h3>
                            <p class="text-sm text-muted-foreground">
                                Once validated, update production configs to use LogWard exclusively.
                                Decommission the old platform and remove unused agents.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    </div>

    <h2
        id="need-help"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Need Help?
    </h2>

    <div class="mb-8">
        <Card>
            <CardContent class="pt-4">
                <p class="mb-4">
                    If you encounter issues during migration or have questions about specific use cases:
                </p>
                <ul class="space-y-2 text-sm">
                    <li class="flex items-center gap-2">
                        <Check class="w-4 h-4 text-green-500" />
                        <a href="https://github.com/logward-dev/logward/issues" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">
                            Open a GitHub issue
                        </a> for bugs or feature requests
                    </li>
                    <li class="flex items-center gap-2">
                        <Check class="w-4 h-4 text-green-500" />
                        <a href="https://github.com/logward-dev/logward/discussions" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">
                            Join GitHub Discussions
                        </a> for questions and community support
                    </li>
                    <li class="flex items-center gap-2">
                        <Check class="w-4 h-4 text-green-500" />
                        Check the <a href="/docs" class="text-primary hover:underline">documentation</a> for detailed API and SDK references
                    </li>
                </ul>
            </CardContent>
        </Card>
    </div>
</div>

<style>
    .docs-content :global(code:not(pre code)) {
        @apply px-1.5 py-0.5 bg-muted rounded text-sm font-mono;
    }
</style>
