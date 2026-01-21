<script lang="ts">
	import { browser } from "$app/environment";
	import { currentOrganization } from "$lib/stores/organization";
	import {
		detectionPacksAPI,
		type DetectionPackWithStatus,
	} from "$lib/api/detection-packs";
	import { toastStore } from "$lib/stores/toast";
	import Card from "$lib/components/ui/card/card.svelte";
	import CardHeader from "$lib/components/ui/card/card-header.svelte";
	import CardTitle from "$lib/components/ui/card/card-title.svelte";
	import CardDescription from "$lib/components/ui/card/card-description.svelte";
	import CardContent from "$lib/components/ui/card/card-content.svelte";
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
	import Bell from "@lucide/svelte/icons/bell";

	let packs = $state<DetectionPackWithStatus[]>([]);
	let loading = $state(false);
	let error = $state("");
	let lastLoadedOrgId = $state<string | null>(null);

	let selectedPack = $state<DetectionPackWithStatus | null>(null);
	let showPackDialog = $state(false);

	const iconMap: Record<string, typeof Rocket> = {
		rocket: Rocket,
		shield: Shield,
		database: Database,
		"credit-card": CreditCard,
	};

	const categoryColors: Record<string, string> = {
		reliability:
			"bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
		security: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
		database:
			"bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
		business:
			"bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
	};

	async function loadPacks() {
		if (!$currentOrganization) return;

		loading = true;
		error = "";

		try {
			const response = await detectionPacksAPI.listPacks(
				$currentOrganization.id
			);
			packs = response.packs || [];
			lastLoadedOrgId = $currentOrganization.id;
		} catch (e) {
			error = e instanceof Error ? e.message : "Failed to load detection packs";
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!browser || !$currentOrganization) {
			packs = [];
			lastLoadedOrgId = null;
			return;
		}

		if ($currentOrganization.id === lastLoadedOrgId) return;

		loadPacks();
	});

	function openPackDialog(pack: DetectionPackWithStatus) {
		selectedPack = pack;
		showPackDialog = true;
	}

	function handlePackDialogSuccess() {
		loadPacks();
	}

	const enabledPacks = $derived(packs.filter((p) => p.enabled));
	const disabledPacks = $derived(packs.filter((p) => !p.enabled));
</script>

<div class="p-6 space-y-6">
	<!-- Header -->
	<div class="flex items-start justify-between">
		<div>
			<div class="flex items-center gap-3 mb-2">
				<Package class="w-6 h-6 text-primary" />
				<h2 class="text-2xl font-bold tracking-tight">Detection Packs</h2>
			</div>
			<p class="text-muted-foreground">
				Pre-configured Sigma rule bundles for common production scenarios.
				Enable a pack to instantly add battle-tested SIEM detection to your logs.
			</p>
		</div>
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-12">
			<Spinner />
			<span class="ml-3 text-muted-foreground">Loading detection packs...</span>
		</div>
	{:else if error}
		<Card>
			<CardContent class="py-12 text-center text-destructive">
				{error}
			</CardContent>
		</Card>
	{:else if packs.length === 0}
		<Card class="border-2 border-dashed">
			<CardContent class="py-16 text-center">
				<div
					class="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center"
				>
					<Package class="w-8 h-8 text-primary" />
				</div>
				<h3 class="text-xl font-semibold mb-2">No detection packs available</h3>
				<p class="text-muted-foreground mb-6 max-w-md mx-auto">
					Detection packs will appear here when they become available.
				</p>
			</CardContent>
		</Card>
	{:else}
		<!-- Enabled Packs Section -->
		{#if enabledPacks.length > 0}
			<div class="space-y-4">
				<h3 class="text-lg font-semibold flex items-center gap-2">
					<CheckCircle class="w-5 h-5 text-green-600" />
					Active Packs ({enabledPacks.length})
				</h3>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each enabledPacks as pack}
						{@const Icon = iconMap[pack.icon] || Package}
						<Card
							class="cursor-pointer hover:border-primary transition-colors"
							onclick={() => openPackDialog(pack)}
						>
							<CardHeader>
								<div class="flex items-start gap-4">
									<div
										class="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0"
									>
										<Icon class="w-6 h-6 text-primary" />
									</div>
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-2 mb-1">
											<CardTitle class="text-lg">{pack.name}</CardTitle>
											<Badge variant="default" class="gap-1">
												<CheckCircle class="w-3 h-3" />
												Enabled
											</Badge>
										</div>
										<CardDescription class="line-clamp-2">
											{pack.description}
										</CardDescription>
									</div>
								</div>
							</CardHeader>
							<CardContent>
								<div class="flex items-center gap-3 text-sm">
									<Badge class={categoryColors[pack.category]}>
										{pack.category}
									</Badge>
									<span class="text-muted-foreground flex items-center gap-1">
										<Bell class="w-4 h-4" />
										{pack.generatedRulesCount} active rules
									</span>
								</div>
							</CardContent>
						</Card>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Available Packs Section -->
		{#if disabledPacks.length > 0}
			<div class="space-y-4">
				<h3 class="text-lg font-semibold">
					Available Packs ({disabledPacks.length})
				</h3>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each disabledPacks as pack}
						{@const Icon = iconMap[pack.icon] || Package}
						<Card
							class="cursor-pointer hover:border-primary transition-colors"
							onclick={() => openPackDialog(pack)}
						>
							<CardHeader>
								<div class="flex items-start gap-4">
									<div
										class="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0"
									>
										<Icon class="w-6 h-6 text-muted-foreground" />
									</div>
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-2 mb-1">
											<CardTitle class="text-lg">{pack.name}</CardTitle>
										</div>
										<CardDescription class="line-clamp-2">
											{pack.description}
										</CardDescription>
									</div>
								</div>
							</CardHeader>
							<CardContent>
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-3 text-sm">
										<Badge class={categoryColors[pack.category]}>
											{pack.category}
										</Badge>
										<span class="text-muted-foreground">
											{pack.rules.length} rules included
										</span>
									</div>
									<Button size="sm" variant="outline">
										View Details
									</Button>
								</div>
							</CardContent>
						</Card>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>

<!-- Pack Dialog -->
{#if $currentOrganization}
	<DetectionPackDialog
		bind:open={showPackDialog}
		pack={selectedPack}
		organizationId={$currentOrganization.id}
		onSuccess={handlePackDialogSuccess}
	/>
{/if}
