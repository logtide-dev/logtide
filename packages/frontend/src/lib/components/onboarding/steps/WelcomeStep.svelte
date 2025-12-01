<script lang="ts">
  import { onboardingStore } from '$lib/stores/onboarding';
  import { goto } from '$app/navigation';
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import { fade, fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import Rocket from '@lucide/svelte/icons/rocket';
  import Clock from '@lucide/svelte/icons/clock';
  import Shield from '@lucide/svelte/icons/shield';
  import Zap from '@lucide/svelte/icons/zap';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import X from '@lucide/svelte/icons/x';

  interface Props {
    userName?: string;
  }

  let { userName = 'there' }: Props = $props();

  function startTutorial() {
    onboardingStore.start();
    onboardingStore.nextStep();
  }

  function skipTutorial() {
    onboardingStore.skip();
    goto('/dashboard');
  }

  const features = [
    {
      icon: Clock,
      title: 'Quick Setup',
      description: 'Get your first logs flowing in under 3 minutes'
    },
    {
      icon: Shield,
      title: 'Secure by Default',
      description: 'API keys and organization isolation out of the box'
    },
    {
      icon: Zap,
      title: 'Powerful Features',
      description: 'Real-time streaming, alerts, and Sigma detection'
    }
  ];
</script>

<div class="space-y-6">
  <!-- Hero section -->
  <div class="text-center space-y-4">
    <div
      class="w-20 h-20 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center"
      in:fly={{ y: -20, duration: 500, delay: 100 }}
    >
      <Rocket class="w-10 h-10 text-primary" />
    </div>

    <div in:fade={{ duration: 400, delay: 200 }}>
      <h1 class="text-3xl font-bold tracking-tight">
        Welcome to LogWard, {userName}!
      </h1>
      <p class="text-muted-foreground mt-2 max-w-md mx-auto">
        Let's get you set up with log monitoring in just a few steps. This guided tour will help you send your first log.
      </p>
    </div>
  </div>

  <!-- Feature highlights -->
  <div
    class="grid gap-4 sm:grid-cols-3"
    in:fly={{ y: 20, duration: 500, delay: 300 }}
  >
    {#each features as feature, i}
      <Card class="text-center bg-card/50">
        <CardContent class="pt-6">
          <div class="w-10 h-10 mx-auto bg-primary/10 rounded-lg flex items-center justify-center mb-3">
            <feature.icon class="w-5 h-5 text-primary" />
          </div>
          <h3 class="font-medium text-sm">{feature.title}</h3>
          <p class="text-xs text-muted-foreground mt-1">{feature.description}</p>
        </CardContent>
      </Card>
    {/each}
  </div>

  <!-- What you'll do -->
  <div in:fly={{ y: 20, duration: 500, delay: 400 }}>
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">What you'll accomplish</CardTitle>
        <CardDescription>Complete these steps to start monitoring your logs</CardDescription>
      </CardHeader>
      <CardContent>
        <ol class="space-y-3">
          <li class="flex items-start gap-3">
            <span class="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">1</span>
            <div>
              <p class="font-medium text-sm">Create your organization</p>
              <p class="text-xs text-muted-foreground">Set up your workspace for managing logs</p>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span class="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">2</span>
            <div>
              <p class="font-medium text-sm">Create a project</p>
              <p class="text-xs text-muted-foreground">Projects help organize logs by application or environment</p>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span class="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">3</span>
            <div>
              <p class="font-medium text-sm">Generate an API key</p>
              <p class="text-xs text-muted-foreground">Get credentials to send logs from your applications</p>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span class="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">4</span>
            <div>
              <p class="font-medium text-sm">Send your first log</p>
              <p class="text-xs text-muted-foreground">Use our code examples to send a test log</p>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span class="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">5</span>
            <div>
              <p class="font-medium text-sm">Explore the dashboard</p>
              <p class="text-xs text-muted-foreground">Learn about search, alerts, and real-time streaming</p>
            </div>
          </li>
        </ol>
      </CardContent>
    </Card>
  </div>

  <!-- Action buttons -->
  <div
    class="flex flex-col sm:flex-row gap-3 justify-center"
    in:fly={{ y: 20, duration: 500, delay: 500 }}
  >
    <Button size="lg" onclick={startTutorial} class="gap-2">
      Start the Tutorial
      <ChevronRight class="w-4 h-4" />
    </Button>
    <Button size="lg" variant="outline" onclick={skipTutorial} class="gap-2 text-muted-foreground">
      <X class="w-4 h-4" />
      Skip for now
    </Button>
  </div>

  <p class="text-center text-xs text-muted-foreground">
    You can always restart this tutorial from settings
  </p>
</div>
