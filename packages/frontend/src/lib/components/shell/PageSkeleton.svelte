<script lang="ts">
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
</script>

<div data-testid="shell-skeleton" class="container mx-auto px-6 py-8 space-y-6" aria-busy="true">
  <span class="sr-only" role="status">Loading</span>
  <div class="space-y-2">
    <Skeleton height="2rem" width="16rem" />
    <Skeleton height="1rem" width="24rem" class="max-w-full" />
  </div>
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
    <Skeleton height="6rem" rounded="lg" />
    <Skeleton height="6rem" rounded="lg" />
    <Skeleton height="6rem" rounded="lg" />
  </div>
  <Skeleton height="16rem" rounded="lg" />
</div>
