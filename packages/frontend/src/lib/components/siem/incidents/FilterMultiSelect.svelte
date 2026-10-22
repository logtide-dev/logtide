<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import Button from '$lib/components/ui/button/button.svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	interface Option {
		value: string;
		label: string;
	}

	interface Props {
		label: string;
		options: Option[];
		selected: string[];
		/** Text shown when nothing is selected. */
		emptyLabel?: string;
		onChange: (next: string[]) => void;
	}

	let { label, options, selected, emptyLabel = 'Any', onChange }: Props = $props();

	const summary = $derived.by(() => {
		if (selected.length === 0) return emptyLabel;
		const names = options.filter((o) => selected.includes(o.value)).map((o) => o.label);
		return names.length <= 2 ? names.join(', ') : `${names.length} selected`;
	});

	function toggle(value: string, checked: boolean) {
		const next = checked
			? options.map((o) => o.value).filter((v) => v === value || selected.includes(v))
			: selected.filter((v) => v !== value);
		onChange(next);
	}
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="sm" class="gap-2">
				<span class="text-muted-foreground">{label}:</span>
				<span>{summary}</span>
				<ChevronDown class="w-4 h-4 opacity-50" aria-hidden="true" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="start" class="w-52 p-2">
		<div role="group" aria-label={label} class="flex flex-col">
			{#each options as option (option.value)}
				<label class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
					<Checkbox
						checked={selected.includes(option.value)}
						onCheckedChange={(v) => toggle(option.value, v === true)}
					/>
					{option.label}
				</label>
			{/each}
		</div>
	</Popover.Content>
</Popover.Root>
