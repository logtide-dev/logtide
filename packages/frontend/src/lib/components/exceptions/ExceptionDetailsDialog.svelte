<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import Spinner from '$lib/components/Spinner.svelte';
	import StackTraceViewer from './StackTraceViewer.svelte';
	import { getExceptionByLogId, type ExceptionWithFrames } from '$lib/api/exceptions';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { goto } from '$app/navigation';

	interface Props {
		open: boolean;
		logId: string;
		organizationId: string;
		onClose: () => void;
	}

	let { open = false, logId, organizationId, onClose }: Props = $props();

	let loading = $state(false);
	let error = $state('');
	let exception = $state<ExceptionWithFrames | null>(null);

	$effect(() => {
		if (open && logId && organizationId) {
			loadException();
		} else {
			exception = null;
			error = '';
		}
	});

	async function loadException() {
		loading = true;
		error = '';

		try {
			exception = await getExceptionByLogId(logId, organizationId);
			if (!exception) {
				error = 'No exception found for this log';
			}
		} catch (e) {
			console.error('Failed to load exception:', e);
			error = e instanceof Error ? e.message : 'Failed to load exception details';
		} finally {
			loading = false;
		}
	}

	function viewErrorGroup() {
		if (exception) {
			// Navigate to error group page
			goto(`/dashboard/errors?fingerprint=${exception.exception.fingerprint}&organizationId=${organizationId}`);
			onClose();
		}
	}
</script>

<Dialog.Root {open} onOpenChange={(isOpen) => !isOpen && onClose()}>
	<Dialog.Content class="max-w-4xl max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<AlertTriangle class="w-5 h-5 text-red-500" />
				Exception Details
			</Dialog.Title>
			<Dialog.Description>
				Parsed stack trace and error information
			</Dialog.Description>
		</Dialog.Header>

		<div class="py-4">
			{#if loading}
				<div class="flex items-center justify-center py-12">
					<Spinner />
					<span class="ml-3 text-muted-foreground">Loading exception details...</span>
				</div>
			{:else if error}
				<div class="text-center py-12">
					<AlertTriangle class="w-12 h-12 text-muted-foreground mx-auto mb-4" />
					<p class="text-muted-foreground">{error}</p>
				</div>
			{:else if exception}
				<StackTraceViewer {exception} />
			{/if}
		</div>

		<Dialog.Footer class="flex justify-between">
			<div>
				{#if exception}
					<Button variant="outline" onclick={viewErrorGroup}>
						<ExternalLink class="w-4 h-4 mr-2" />
						View Error Group
					</Button>
				{/if}
			</div>
			<Button variant="outline" onclick={onClose}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
