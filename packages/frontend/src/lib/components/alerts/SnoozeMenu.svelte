<script lang="ts">
	import type { AlertRule } from '$lib/api/alerts';
	import { deriveRuleState } from '$lib/components/alerts/alert-model';
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import * as Popover from '$lib/components/ui/popover';
	import BellOff from '@lucide/svelte/icons/bell-off';

	interface Props {
		rule: AlertRule;
		busy?: boolean;
		onSnooze: (untilIso: string) => void;
		onUnsnooze: () => void;
	}

	let { rule, busy = false, onSnooze, onUnsnooze }: Props = $props();

	const PRESETS: { label: string; hours: number }[] = [
		{ label: 'Snooze for 1 hour', hours: 1 },
		{ label: 'Snooze for 4 hours', hours: 4 },
		{ label: 'Snooze for 24 hours', hours: 24 },
	];

	let open = $state(false);
	let customOpen = $state(false);
	let customValue = $state('');
	let customError = $state<string | null>(null);

	const snoozed = $derived(deriveRuleState(rule) === 'snoozed');

	function snoozeFor(hours: number) {
		onSnooze(new Date(Date.now() + hours * 3_600_000).toISOString());
		open = false;
	}

	function snoozeUntil() {
		// datetime-local carries no zone: it is read as the viewer's local time.
		const time = customValue ? new Date(customValue).getTime() : NaN;
		if (Number.isNaN(time) || time <= Date.now()) {
			customError = 'Choose a time in the future';
			return;
		}
		customError = null;
		onSnooze(new Date(time).toISOString());
		customValue = '';
		customOpen = false;
		open = false;
	}

	function unsnooze() {
		onUnsnooze();
		open = false;
	}

	const ITEM =
		'w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed';
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant="ghost"
				size="icon"
				class="h-8 w-8"
				aria-label="Snooze alert"
				disabled={busy}
			>
				<BellOff class="h-4 w-4" aria-hidden="true" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-56 p-1" align="end">
		<div class="flex flex-col">
			{#each PRESETS as preset (preset.hours)}
				<button type="button" class={ITEM} disabled={busy} onclick={() => snoozeFor(preset.hours)}>
					{preset.label}
				</button>
			{/each}
			<button
				type="button"
				class={ITEM}
				aria-expanded={customOpen}
				onclick={() => (customOpen = !customOpen)}
			>
				Snooze until...
			</button>
			{#if customOpen}
				<div class="space-y-2 p-2">
					<Input
						type="datetime-local"
						aria-label="Snooze until"
						bind:value={customValue}
						disabled={busy}
					/>
					{#if customError}
						<p class="text-xs text-destructive-text" role="alert">{customError}</p>
					{/if}
					<Button type="button" size="sm" class="w-full" disabled={busy} onclick={snoozeUntil}>Snooze</Button>
				</div>
			{/if}
			{#if snoozed}
				<div class="my-1 h-px bg-border" role="separator"></div>
				<button type="button" class={ITEM} disabled={busy} onclick={unsnooze}>Unsnooze</button>
			{/if}
		</div>
	</Popover.Content>
</Popover.Root>
