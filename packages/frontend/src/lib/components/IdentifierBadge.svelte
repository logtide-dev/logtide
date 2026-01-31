<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import Link2 from '@lucide/svelte/icons/link-2';

  interface Props {
    type: string;
    value: string;
    onclick?: () => void;
  }

  let { type, value, onclick }: Props = $props();

  function formatType(type: string): string {
    // Convert snake_case to Title Case
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function truncateValue(value: string, maxLength = 24): string {
    if (value.length <= maxLength) return value;
    return `${value.substring(0, maxLength - 3)}...`;
  }

  function getTypeColor(type: string): string {
    switch (type) {
      case 'request_id':
        return 'bg-blue-500/20 text-blue-700 dark:text-blue-300 hover:bg-blue-500/30 border border-blue-500/30';
      case 'user_id':
        return 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30';
      case 'session_id':
        return 'bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-500/30 border border-amber-500/30';
      case 'transaction_id':
        return 'bg-orange-500/20 text-orange-700 dark:text-orange-300 hover:bg-orange-500/30 border border-orange-500/30';
      case 'order_id':
        return 'bg-rose-500/20 text-rose-700 dark:text-rose-300 hover:bg-rose-500/30 border border-rose-500/30';
      case 'correlation_id':
        return 'bg-violet-500/20 text-violet-700 dark:text-violet-300 hover:bg-violet-500/30 border border-violet-500/30';
      case 'trace_id':
        return 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/30 border border-indigo-500/30';
      case 'span_id':
        return 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30';
      case 'uuid':
        return 'bg-slate-500/20 text-slate-700 dark:text-slate-300 hover:bg-slate-500/30 border border-slate-500/30';
      default:
        return 'bg-zinc-500/20 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-500/30 border border-zinc-500/30';
    }
  }
</script>

<button
  class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono rounded cursor-pointer transition-colors border-none {getTypeColor(type)}"
  {onclick}
  title="Click to see all events with {formatType(type)}: {value}"
>
  <Link2 class="w-3 h-3" />
  <span class="font-medium">{formatType(type)}:</span>
  <span>{truncateValue(value)}</span>
</button>
