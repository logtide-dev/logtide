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
        return 'bg-blue-100 text-blue-800 hover:bg-blue-200';
      case 'user_id':
        return 'bg-green-100 text-green-800 hover:bg-green-200';
      case 'session_id':
        return 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200';
      case 'transaction_id':
        return 'bg-orange-100 text-orange-800 hover:bg-orange-200';
      case 'order_id':
        return 'bg-pink-100 text-pink-800 hover:bg-pink-200';
      case 'correlation_id':
        return 'bg-purple-100 text-purple-800 hover:bg-purple-200';
      case 'trace_id':
        return 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200';
      case 'span_id':
        return 'bg-cyan-100 text-cyan-800 hover:bg-cyan-200';
      case 'uuid':
        return 'bg-gray-100 text-gray-800 hover:bg-gray-200';
      default:
        return 'bg-slate-100 text-slate-800 hover:bg-slate-200';
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
