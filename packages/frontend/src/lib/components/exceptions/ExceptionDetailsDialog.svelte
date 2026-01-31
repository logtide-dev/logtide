<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import Spinner from '$lib/components/Spinner.svelte';
	import StackTraceViewer from './StackTraceViewer.svelte';
	import { getExceptionByLogId, type ExceptionWithFrames } from '$lib/api/exceptions';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import { goto } from '$app/navigation';
	import { copyToClipboard } from '$lib/utils/clipboard';

	interface Props {
		open: boolean;
		logId: string;
		organizationId: string;
		metadata?: Record<string, unknown> | null;
		onClose: () => void;
	}

	let { open = false, logId, organizationId, metadata = null, onClose }: Props = $props();

	// Known error-related field names to extract from metadata
	const ERROR_FIELDS = ['stack', 'stackTrace', 'stack_trace', 'error', 'reason', 'message', 'exception', 'cause'];
	const CONTEXT_FIELDS = ['env', 'environment', 'service', 'version', 'hostname', 'host', 'node', 'pid', 'promise'];

	let stackCopied = $state(false);

	function getErrorFieldsFromMetadata(): { errorFields: Record<string, unknown>; contextFields: Record<string, unknown> } | null {
		if (!metadata || typeof metadata !== 'object') return null;

		const errorFields: Record<string, unknown> = {};
		const contextFields: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(metadata)) {
			const lowerKey = key.toLowerCase();
			if (ERROR_FIELDS.some(f => lowerKey.includes(f.toLowerCase()))) {
				errorFields[key] = value;
			} else if (CONTEXT_FIELDS.some(f => lowerKey === f.toLowerCase())) {
				contextFields[key] = value;
			}
		}

		return Object.keys(errorFields).length > 0 ? { errorFields, contextFields } : null;
	}

	async function copyStack(stack: string) {
		const success = await copyToClipboard(stack);
		if (success) {
			stackCopied = true;
			setTimeout(() => stackCopied = false, 2000);
		}
	}

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
			{:else if exception}
				<StackTraceViewer {exception} />
			{:else}
				{@const metadataError = getErrorFieldsFromMetadata()}
				{#if metadataError}
					<!-- Fallback: Show error info from metadata -->
					<div class="space-y-4">
						{#if metadataError.errorFields.reason || metadataError.errorFields.message || metadataError.errorFields.error}
							<div>
								<h4 class="text-sm font-semibold text-muted-foreground mb-2">Error</h4>
								<div class="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
									<p class="font-mono text-sm text-red-600 dark:text-red-400">
										{metadataError.errorFields.reason || metadataError.errorFields.message || metadataError.errorFields.error}
									</p>
								</div>
							</div>
						{/if}

						{#if metadataError.errorFields.stack || metadataError.errorFields.stackTrace || metadataError.errorFields.stack_trace}
							{@const stackValue = String(metadataError.errorFields.stack || metadataError.errorFields.stackTrace || metadataError.errorFields.stack_trace)}
							<div>
								<div class="flex items-center justify-between mb-2">
									<h4 class="text-sm font-semibold text-muted-foreground">Stack Trace</h4>
									<Button
										variant="ghost"
										size="sm"
										onclick={() => copyStack(stackValue)}
										class="h-7 px-2 text-xs"
									>
										{#if stackCopied}
											<Check class="w-3 h-3 mr-1 text-green-500" />
											Copied
										{:else}
											<Copy class="w-3 h-3 mr-1" />
											Copy
										{/if}
									</Button>
								</div>
								<div class="p-3 bg-muted rounded-md max-h-80 overflow-auto">
									<pre class="text-xs font-mono whitespace-pre-wrap break-all">{stackValue}</pre>
								</div>
							</div>
						{/if}

						{#if Object.keys(metadataError.contextFields).length > 0}
							<div>
								<h4 class="text-sm font-semibold text-muted-foreground mb-2">Context</h4>
								<div class="grid grid-cols-2 gap-2">
									{#each Object.entries(metadataError.contextFields) as [key, value]}
										<div class="p-2 bg-muted rounded-md">
											<span class="text-xs text-muted-foreground">{key}</span>
											<p class="font-mono text-sm truncate" title={String(value)}>{String(value)}</p>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<p class="text-xs text-muted-foreground italic mt-4">
							Showing error details from log metadata. For parsed stack traces, ensure errors are sent with structured exception data.
						</p>
					</div>
				{:else if error}
					<div class="text-center py-12">
						<AlertTriangle class="w-12 h-12 text-muted-foreground mx-auto mb-4" />
						<p class="text-muted-foreground">{error}</p>
					</div>
				{:else}
					<div class="text-center py-12">
						<AlertTriangle class="w-12 h-12 text-muted-foreground mx-auto mb-4" />
						<p class="text-muted-foreground">No exception details available</p>
					</div>
				{/if}
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
