<script lang="ts">
  import { onboardingStore } from '$lib/stores/onboarding';
  import { goto } from '$app/navigation';
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import { fly, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Search from '@lucide/svelte/icons/search';
  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import Bell from '@lucide/svelte/icons/bell';
  import Radio from '@lucide/svelte/icons/radio';
  import Shield from '@lucide/svelte/icons/shield';
  import Route from '@lucide/svelte/icons/route';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ExternalLink from '@lucide/svelte/icons/external-link';

  const features = [
    {
      icon: LayoutDashboard,
      title: 'Dashboard',
      description: 'Get an overview of your logs with real-time stats, charts, and top services.',
      link: '/dashboard',
      color: 'bg-blue-500/10 text-blue-500'
    },
    {
      icon: Search,
      title: 'Search & Filter',
      description: 'Find any log instantly with powerful filters by service, level, time, and full-text search.',
      link: '/search',
      color: 'bg-purple-500/10 text-purple-500'
    },
    {
      icon: Bell,
      title: 'Alerts',
      description: 'Set up threshold-based alerts with email and webhook notifications.',
      link: '/alerts',
      color: 'bg-orange-500/10 text-orange-500'
    },
    {
      icon: Route,
      title: 'Traces',
      description: 'Visualize distributed traces and analyze request flows across your services.',
      link: '/traces',
      color: 'bg-cyan-500/10 text-cyan-500'
    },
    {
      icon: Radio,
      title: 'Live Tail',
      description: 'Watch logs stream in real-time as they happen. Perfect for debugging.',
      link: '/search?live=true',
      color: 'bg-green-500/10 text-green-500'
    },
    {
      icon: Shield,
      title: 'Sigma Rules',
      description: 'Detect security threats with industry-standard Sigma detection rules.',
      link: '/projects',
      color: 'bg-red-500/10 text-red-500'
    }
  ];

  function handleComplete() {
    onboardingStore.completeStep('feature-tour');
    goto('/dashboard');
  }

  function openFeature(link: string) {
    window.open(link, '_blank');
  }
</script>

<div class="space-y-6" in:fly={{ y: 20, duration: 400 }}>
  <div class="text-center space-y-2">
    <div class="w-16 h-16 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center">
      <Sparkles class="w-8 h-8 text-primary" />
    </div>
    <h2 class="text-2xl font-bold">You're All Set!</h2>
    <p class="text-muted-foreground max-w-md mx-auto">
      Here's a quick overview of what you can do with LogWard. Explore these features to get the most out of your logs.
    </p>
  </div>

  <!-- Feature cards -->
  <div class="grid gap-3">
    {#each features as feature, i}
      <div in:fly={{ y: 20, duration: 300, delay: i * 100 }}>
        <Card class="cursor-pointer hover:border-primary/50 transition-all">
          <CardContent class="p-4">
            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 {feature.color}">
                <feature.icon class="w-5 h-5" />
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-medium">{feature.title}</h3>
                <p class="text-sm text-muted-foreground">{feature.description}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => openFeature(feature.link)}
                class="flex-shrink-0"
              >
                <ExternalLink class="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    {/each}
  </div>

  <!-- Tips -->
  <Card class="bg-primary/5 border-primary/20">
    <CardContent class="pt-4">
      <h3 class="font-medium text-sm mb-2">Pro Tips</h3>
      <ul class="text-sm text-muted-foreground space-y-1">
        <li>Use <kbd class="px-1.5 py-0.5 bg-muted rounded text-xs">Ctrl+K</kbd> for quick search anywhere</li>
        <li>Click on a trace ID to see all related logs</li>
        <li>Set up alerts before going to production</li>
        <li>Check out the <a href="/docs" class="text-primary hover:underline">documentation</a> for SDK guides</li>
      </ul>
    </CardContent>
  </Card>

  <Button onclick={handleComplete} size="lg" class="w-full gap-2">
    Go to Dashboard
    <ChevronRight class="w-4 h-4" />
  </Button>
</div>
