<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import DashboardsView from '$lib/components/custom-dashboards/DashboardsView.svelte';

  function navigate(url: URL) {
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
  }
</script>

<DashboardsView url={page.url} {navigate} />
