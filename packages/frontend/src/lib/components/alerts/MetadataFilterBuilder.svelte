<script lang="ts">
	import type { MetadataFilterInput, MetadataFilterOp } from '@logtide/shared';
	import { METADATA_FILTER_OPS } from '@logtide/shared';
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';

	interface Props {
		filters: MetadataFilterInput[];
		disabled?: boolean;
	}

	let { filters = $bindable(), disabled = false }: Props = $props();

	const NEGATIVE: MetadataFilterOp[] = ['not_equals', 'not_in', 'not_exists'];
	const TAKES_VALUE: MetadataFilterOp[] = ['equals', 'not_equals', 'contains'];
	const TAKES_VALUES: MetadataFilterOp[] = ['in', 'not_in'];

	const OP_LABELS: Record<MetadataFilterOp, string> = {
		equals: 'equals',
		not_equals: 'not equals',
		in: 'in',
		not_in: 'not in',
		exists: 'exists',
		not_exists: 'not exists',
		contains: 'contains',
	};

	function addFilter() {
		filters = [...filters, { key: '', op: 'exists', include_missing: false }];
	}

	function removeFilter(i: number) {
		filters = filters.filter((_, idx) => idx !== i);
	}

	function updateOp(i: number, op: MetadataFilterOp) {
		const next = [...filters];
		const cur = next[i];
		const cleaned: MetadataFilterInput = {
			key: cur.key,
			op,
			include_missing: NEGATIVE.includes(op),
		};
		if (TAKES_VALUE.includes(op)) cleaned.value = cur.value ?? '';
		if (TAKES_VALUES.includes(op)) cleaned.values = cur.values ?? [];
		next[i] = cleaned;
		filters = next;
	}

	function updateValuesCsv(i: number, csv: string) {
		const next = [...filters];
		next[i] = {
			...next[i],
			values: csv
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean),
		};
		filters = next;
	}

	const selectClass =
		'border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
</script>

<div class="space-y-3">
	{#if filters.length > 0}
		<div class="space-y-2">
			{#each filters as f, i (i)}
				<div class="space-y-1" data-testid="metadata-filter-row">
					<div class="flex gap-2 items-center">
						<Input
							type="text"
							class="w-36 shrink-0"
							placeholder="metadata key"
							aria-label="Metadata key"
							data-testid="metadata-filter-key"
							bind:value={filters[i].key}
							{disabled}
						/>

						<select
							class="{selectClass} w-36 shrink-0"
							data-testid="metadata-filter-op"
							aria-label="Operator"
							value={f.op}
							onchange={(e) =>
								updateOp(i, (e.currentTarget as HTMLSelectElement).value as MetadataFilterOp)}
							{disabled}
						>
							{#each METADATA_FILTER_OPS as op}
								<option value={op}>{OP_LABELS[op]}</option>
							{/each}
						</select>

						{#if TAKES_VALUE.includes(f.op)}
							<Input
								type="text"
								class="flex-1 min-w-0"
								placeholder="value"
								aria-label="Value"
								data-testid="metadata-filter-value"
								bind:value={filters[i].value}
								{disabled}
							/>
						{:else if TAKES_VALUES.includes(f.op)}
							<Input
								type="text"
								class="flex-1 min-w-0"
								placeholder="val1, val2, ..."
								aria-label="Values"
								data-testid="metadata-filter-values"
								value={(f.values ?? []).join(', ')}
								oninput={(e) =>
									updateValuesCsv(i, (e.currentTarget as HTMLInputElement).value)}
								{disabled}
							/>
						{:else}
							<div class="flex-1"></div>
						{/if}

						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label="Remove filter"
							data-testid="metadata-filter-remove"
							onclick={() => removeFilter(i)}
							{disabled}
						>
							<span class="text-base leading-none">×</span>
						</Button>
					</div>

					{#if NEGATIVE.includes(f.op)}
						<label class="flex items-center gap-2 ml-1 cursor-pointer">
							<input
								type="checkbox"
								class="rounded border-input"
								bind:checked={filters[i].include_missing}
								{disabled}
							/>
							<span class="text-xs text-muted-foreground">
								Match logs where <code class="font-mono">{f.key || 'key'}</code> is missing
							</span>
						</label>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<Button
		type="button"
		variant="outline"
		size="sm"
		data-testid="metadata-filter-add"
		onclick={addFilter}
		disabled={disabled || filters.length >= 10}
		class="gap-1"
	>
		+ Add metadata filter
	</Button>

	{#if filters.length >= 10}
		<p class="text-xs text-muted-foreground">Maximum of 10 metadata filters reached.</p>
	{/if}
</div>
