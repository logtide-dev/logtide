<script lang="ts">
  // Embed-badge helper for the public status page.
  // Lets the user pick from 5 badge styles, previews the chosen variant live,
  // and exposes ready-to-paste HTML / Markdown snippets plus the raw JSON URL.

  import { toastStore } from '$lib/stores/toast';
  import { getApiUrl } from '$lib/config';
  import Copy from '@lucide/svelte/icons/copy';

  type BadgeStyle = 'flat' | 'flat-square' | 'plastic' | 'for-the-badge' | 'minimal';

  interface Props {
    projectSlug: string;
  }

  let { projectSlug }: Props = $props();

  let style = $state<BadgeStyle>('flat');

  const styleOptions: Array<{ value: BadgeStyle; label: string; description: string }> = [
    { value: 'flat', label: 'Flat', description: 'Classic GitHub-style two-tone badge with subtle gradient' },
    { value: 'flat-square', label: 'Flat Square', description: 'Same as flat without rounded corners or gradient' },
    { value: 'plastic', label: 'Plastic', description: 'Slightly rounded with stronger 3D gradient' },
    { value: 'for-the-badge', label: 'For The Badge', description: 'Big block-style uppercase badge' },
    { value: 'minimal', label: 'Minimal', description: 'Pill-shaped dark badge with a colored status dot' },
  ];

  // Two URL strategies:
  //  - `previewUrl` is what the <img> in this page actually loads. We use the
  //    real API base from getApiUrl() so it works in dev mode where the
  //    frontend is on a different port than the backend.
  //  - `embedUrl` is the URL we put inside the HTML/Markdown snippets the
  //    user copies. We prefer an absolute URL so the snippet still works
  //    when pasted on a third-party site.
  const apiBase = $derived.by(() => {
    const apiUrl = getApiUrl();
    if (apiUrl) return apiUrl;
    // Reverse-proxy setup: same origin serves both frontend and API.
    if (typeof window !== 'undefined') return window.location.origin;
    return '';
  });

  const styleQuery = $derived(style === 'flat' ? '' : `?style=${style}`);

  const previewSvgUrl = $derived(
    `${apiBase}/api/v1/status/project/${projectSlug}/badge.svg${styleQuery}`
  );
  const svgUrl = previewSvgUrl;
  const jsonUrl = $derived(`${apiBase}/api/v1/status/project/${projectSlug}/badge.json`);
  const statusPageUrl = $derived(
    `${apiBase || (typeof window !== 'undefined' ? window.location.origin : '')}/status/${projectSlug}`
  );

  const htmlSnippet = $derived(
    `<a href="${statusPageUrl}" target="_blank" rel="noopener">
  <img src="${svgUrl}" alt="System status" />
</a>`
  );

  const markdownSnippet = $derived(
    `[![System status](${svgUrl})](${statusPageUrl})`
  );

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toastStore.success(`${label} copied`);
    } catch {
      toastStore.error('Could not copy to clipboard');
    }
  }
</script>

<div class="space-y-3">
  <p class="text-xs text-muted-foreground">
    Drop the live status badge on your own website, README, or blog post. The
    badge auto-updates every 60 seconds and works for projects with status page
    visibility set to <strong>Public</strong>.
  </p>

  <!-- Style picker -->
  <div class="space-y-1.5">
    <label class="text-xs font-medium" for="badge-style">Style</label>
    <select
      id="badge-style"
      bind:value={style}
      class="h-8 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
    >
      {#each styleOptions as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
    <p class="text-[11px] text-muted-foreground">
      {styleOptions.find((o) => o.value === style)?.description}
    </p>
  </div>

  <!-- Live preview -->
  <div class="rounded-md border bg-background p-3 flex flex-wrap items-center gap-3">
    <span class="text-xs font-medium text-muted-foreground">Preview:</span>
    <a href={statusPageUrl} target="_blank" rel="noopener" class="inline-block">
      <!-- key prop forces full reload when style changes so we don't get cached SVG -->
      {#key style}
        <img src={previewSvgUrl} alt="System status" class="block max-h-8" />
      {/key}
    </a>
  </div>

  <!-- HTML snippet -->
  <div class="space-y-1.5">
    <div class="flex items-center justify-between">
      <label class="text-xs font-medium" for="badge-html">HTML</label>
      <button
        type="button"
        class="flex items-center gap-1 text-xs text-primary hover:underline"
        onclick={() => copy(htmlSnippet, 'HTML snippet')}
      >
        <Copy class="h-3 w-3" />
        Copy
      </button>
    </div>
    <textarea
      id="badge-html"
      readonly
      rows="3"
      value={htmlSnippet}
      class="w-full rounded-md border bg-muted/30 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-none"
      onclick={(e) => (e.currentTarget as HTMLTextAreaElement).select()}
    ></textarea>
  </div>

  <!-- Markdown snippet -->
  <div class="space-y-1.5">
    <div class="flex items-center justify-between">
      <label class="text-xs font-medium" for="badge-md">Markdown</label>
      <button
        type="button"
        class="flex items-center gap-1 text-xs text-primary hover:underline"
        onclick={() => copy(markdownSnippet, 'Markdown snippet')}
      >
        <Copy class="h-3 w-3" />
        Copy
      </button>
    </div>
    <input
      id="badge-md"
      readonly
      type="text"
      value={markdownSnippet}
      class="w-full rounded-md border bg-muted/30 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary"
      onclick={(e) => (e.currentTarget as HTMLInputElement).select()}
    />
  </div>

  <!-- JSON endpoint -->
  <div class="space-y-1.5">
    <div class="flex items-center justify-between">
      <label class="text-xs font-medium" for="badge-json">JSON endpoint</label>
      <button
        type="button"
        class="flex items-center gap-1 text-xs text-primary hover:underline"
        onclick={() => copy(jsonUrl, 'JSON URL')}
      >
        <Copy class="h-3 w-3" />
        Copy
      </button>
    </div>
    <input
      id="badge-json"
      readonly
      type="text"
      value={jsonUrl}
      class="w-full rounded-md border bg-muted/30 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary"
      onclick={(e) => (e.currentTarget as HTMLInputElement).select()}
    />
    <p class="text-[11px] text-muted-foreground">
      Returns <code>{`{ status, label, color, updatedAt }`}</code>. CORS-enabled,
      cached for 60s.
    </p>
  </div>
</div>
