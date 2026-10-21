<script lang="ts">
  interface Props {
    name: string;
    email?: string;
    size?: 'sm' | 'md';
  }

  let { name, email, size = 'md' }: Props = $props();

  // Complete literal class strings so the Tailwind JIT sees them.
  const COLORS = [
    'bg-primary/15 text-primary-text',
    'bg-info/15 text-info-text',
    'bg-success/15 text-success-text',
    'bg-warning/15 text-warning-text',
    'bg-critical/15 text-critical-text',
    'bg-destructive/15 text-destructive-text',
    'bg-secondary text-secondary-foreground',
    'bg-muted text-muted-foreground',
  ];

  function hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  const initials = $derived.by(() => {
    const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      return words
        .slice(0, 2)
        .map((w) => Array.from(w)[0])
        .join('')
        .toUpperCase();
    }
    const local = (email ?? '').split('@')[0]?.trim();
    if (local) return Array.from(local)[0].toUpperCase();
    return '?';
  });

  const color = $derived(COLORS[hash(email || name || '') % COLORS.length]);
  const sizeClass = $derived(size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-xs');
</script>

<span
  role="img"
  aria-label={name || email || 'Unknown user'}
  class="inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium {sizeClass} {color}"
>
  <span aria-hidden="true">{initials}</span>
</span>
