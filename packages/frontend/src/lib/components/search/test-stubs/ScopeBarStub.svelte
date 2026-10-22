<script lang="ts">
  // Test double for F2's ScopeBar: renders its inputs as data attributes so a
  // page test can read them, and never touches the scope store or the URL.
  interface Props {
    mode: 'multi' | 'single';
    projects: { id: string; name: string }[];
    showProjects?: boolean;
    showTime?: boolean;
    timeDisabled?: boolean;
    presets?: string[];
  }

  let { mode, projects, timeDisabled = false }: Props = $props();
</script>

<div
  data-testid="scope-bar"
  data-mode={mode}
  data-time-disabled={String(timeDisabled)}
  data-projects={projects.map((p) => p.id).join(',')}
></div>
