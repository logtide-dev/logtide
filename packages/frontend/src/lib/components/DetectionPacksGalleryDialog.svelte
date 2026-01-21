<script lang="ts">
	import { browser } from "$app/environment";
	import {
		detectionPacksAPI,
		type DetectionPackWithStatus,
	} from "$lib/api/detection-packs";
	import { toastStore } from "$lib/stores/toast";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Badge } from "$lib/components/ui/badge";
	import Button from "$lib/components/ui/button/button.svelte";
	import Spinner from "$lib/components/Spinner.svelte";
	import DetectionPackDialog from "$lib/components/DetectionPackDialog.svelte";
	import Package from "@lucide/svelte/icons/package";
	import Rocket from "@lucide/svelte/icons/rocket";
	import Shield from "@lucide/svelte/icons/shield";
	import Database from "@lucide/svelte/icons/database";
	import CreditCard from "@lucide/svelte/icons/credit-card";
	import CheckCircle from "@lucide/svelte/icons/check-circle";
	import MessageSquarePlus from "@lucide/svelte/icons/message-square-plus";

	interface Props {
		open: boolean;
		organizationId: string;
		onSuccess?: () => void;
		onOpenChange?: (open: boolean) => void;
	}

	let {
		open = $bindable(),
		organizationId,
		onSuccess,
		onOpenChange,
	}: Props = $props();

	let packs = $state<DetectionPackWithStatus[]>([]);
	let loading = $state(false);
	let selectedPack = $state<DetectionPackWithStatus | null>(null);
	let showPackDialog = $state(false);

	const iconMap: Record<string, typeof Rocket> = {
		rocket: Rocket,
		shield: Shield,
		database: Database,
		"credit-card": CreditCard,
	};

	const categoryColors: Record<string, string> = {
		reliability: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
		security: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
		database: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
		business: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
	};

	async function loadPacks() {
		if (!organizationId) return;

		loading = true;

		try {
			const response = await detectionPacksAPI.listPacks(organizationId);
			packs = response.packs || [];
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : "Failed to load detection packs");
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open && browser && organizationId) {
			loadPacks();
		}
	});

	function openPackDialog(pack: DetectionPackWithStatus) {
		selectedPack = pack;
		showPackDialog = true;
	}

	function handlePackSuccess() {
		loadPacks();
		onSuccess?.();
	}

	const enabledPacks = $derived(packs.filter((p) => p.enabled));
	const disabledPacks = $derived(packs.filter((p) => !p.enabled));

	const suggestPackUrl = `https://github.com/logtide-dev/logtide/issues/new?${new URLSearchParams({
		title: "[Detection Pack] ",
		body: `## Detection Pack Suggestion

**Pack Name:**
<!-- e.g., "Kubernetes Health Pack" -->

**Category:**
<!-- reliability / security / database / business -->

**Description:**
<!-- What does this pack monitor? What problems does it detect? -->

**Suggested Rules:**
<!-- List the detection rules you'd like to see -->
-
-
-

**Use Case:**
<!-- When would this pack be useful? What type of applications/infrastructure? -->

**References:**
<!-- Any documentation, articles, or examples that could help -->
`,
		labels: "enhancement,detection-pack"
	}).toString()}`;
</script>

<Dialog.Root
	{open}
	onOpenChange={(o) => {
		open = o;
		onOpenChange?.(o);
	}}
>
	<Dialog.Content class="max-w-4xl max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<div class="flex items-center gap-3">
				<div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
					<Package class="w-5 h-5 text-primary" />
				</div>
				<div>
					<Dialog.Title>Detection Packs</Dialog.Title>
					<Dialog.Description>
						Pre-configured Sigma rule bundles for common production scenarios.
						Enable a pack to instantly add SIEM detection to your logs.
					</Dialog.Description>
				</div>
			</div>
		</Dialog.Header>

		<div class="py-4 space-y-6">
			{#if loading}
				<div class="flex items-center justify-center py-12">
					<Spinner />
					<span class="ml-3 text-muted-foreground">Loading detection packs...</span>
				</div>
			{:else if packs.length === 0}
				<div class="py-12 text-center">
					<div class="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
						<Package class="w-8 h-8 text-primary" />
					</div>
					<h3 class="text-xl font-semibold mb-2">No detection packs available</h3>
					<p class="text-muted-foreground">
						Detection packs will appear here when they become available.
					</p>
				</div>
			{:else}
				<!-- Enabled Packs -->
				{#if enabledPacks.length > 0}
					<div class="space-y-3">
						<h4 class="font-medium text-sm flex items-center gap-2">
							<CheckCircle class="w-4 h-4 text-green-600" />
							Active Packs ({enabledPacks.length})
						</h4>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
							{#each enabledPacks as pack}
								{@const Icon = iconMap[pack.icon] || Package}
								<button
									type="button"
									class="text-left border rounded-lg p-4 hover:border-primary transition-colors bg-card"
									onclick={() => openPackDialog(pack)}
								>
									<div class="flex items-start gap-3">
										<div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
											<Icon class="w-5 h-5 text-primary" />
										</div>
										<div class="flex-1 min-w-0">
											<div class="flex items-center gap-2 mb-1">
												<span class="font-medium truncate">{pack.name}</span>
												<Badge variant="default" class="gap-1 text-xs">
													<CheckCircle class="w-3 h-3" />
													Active
												</Badge>
											</div>
											<p class="text-sm text-muted-foreground line-clamp-2">
												{pack.description}
											</p>
											<div class="flex items-center gap-2 mt-2">
												<Badge class={categoryColors[pack.category]} variant="secondary">
													{pack.category}
												</Badge>
												<span class="text-xs text-muted-foreground">
													{pack.generatedRulesCount} rules active
												</span>
											</div>
										</div>
									</div>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Available Packs -->
				{#if disabledPacks.length > 0}
					<div class="space-y-3">
						<h4 class="font-medium text-sm">
							Available Packs ({disabledPacks.length})
						</h4>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
							{#each disabledPacks as pack}
								{@const Icon = iconMap[pack.icon] || Package}
								<button
									type="button"
									class="text-left border rounded-lg p-4 hover:border-primary transition-colors"
									onclick={() => openPackDialog(pack)}
								>
									<div class="flex items-start gap-3">
										<div class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
											<Icon class="w-5 h-5 text-muted-foreground" />
										</div>
										<div class="flex-1 min-w-0">
											<span class="font-medium block truncate mb-1">{pack.name}</span>
											<p class="text-sm text-muted-foreground line-clamp-2">
												{pack.description}
											</p>
											<div class="flex items-center gap-2 mt-2">
												<Badge class={categoryColors[pack.category]} variant="secondary">
													{pack.category}
												</Badge>
												<span class="text-xs text-muted-foreground">
													{pack.rules.length} rules
												</span>
											</div>
										</div>
									</div>
								</button>
							{/each}
						</div>
					</div>
				{/if}
			{/if}
		</div>

		<Dialog.Footer class="flex-col sm:flex-row gap-2">
			<a
				href={suggestPackUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
			>
				<MessageSquarePlus class="w-4 h-4" />
				Suggest a new pack
			</a>
			<div class="flex-1"></div>
			<Button variant="outline" onclick={() => (open = false)}>
				Close
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Pack Detail Dialog -->
<DetectionPackDialog
	bind:open={showPackDialog}
	pack={selectedPack}
	{organizationId}
	onSuccess={handlePackSuccess}
/>
