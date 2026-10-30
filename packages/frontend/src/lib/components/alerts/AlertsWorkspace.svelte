<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { DetectionEvent } from '@logtide/shared';
	import { currentOrganization } from '$lib/stores/organization';
	import { scopeStore, readScopeFromUrl } from '$lib/stores/scope';
	import { toastStore } from '$lib/stores/toast';
	import {
		alertsAPI,
		type AlertRule,
		type AlertHistory,
		type AlertBuilderPrefill,
	} from '$lib/api/alerts';
	import { getRecentDetections } from '$lib/api/siem';
	import { projectsAPI } from '$lib/api/projects';
	import { notificationChannelsAPI } from '$lib/api/notification-channels';
	import { parseAlertPrefill, stripPrefillParams } from '$lib/components/alerts/alert-model';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import ScopeBar from '$lib/components/app/ScopeBar.svelte';
	import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import DetectionPacksGalleryDialog from '$lib/components/DetectionPacksGalleryDialog.svelte';
	import CreateAlertDialog from '$lib/components/CreateAlertDialog.svelte';
	import EditAlertDialog from '$lib/components/EditAlertDialog.svelte';
	import AlertRulesTable from '$lib/components/alerts/AlertRulesTable.svelte';
	import AlertHistoryTable from '$lib/components/alerts/AlertHistoryTable.svelte';
	import Package from '@lucide/svelte/icons/package';
	import Plus from '@lucide/svelte/icons/plus';

	interface Props {
		lockedProjectId?: string | null;
		embedded?: boolean;
	}

	let { lockedProjectId = null, embedded = false }: Props = $props();

	const HISTORY_PAGE = 50;

	let rules = $state<AlertRule[]>([]);
	let history = $state<AlertHistory[]>([]);
	let historyTotal = $state(0);
	let detections = $state<DetectionEvent[]>([]);
	let projects = $state<{ id: string; name: string }[]>([]);
	let channelNames = $state<Record<string, string>>({});
	let loading = $state(true);
	let loadingMore = $state(false);
	let loadError = $state('');
	let loadedOrg = $state<string | null>(null);
	let loadedProject = $state<string | null>(null);
	let busyIds = $state<string[]>([]);

	let showCreate = $state(false);
	let createPrefill = $state<AlertBuilderPrefill | undefined>(undefined);
	let showEdit = $state(false);
	let ruleToEdit = $state<AlertRule | null>(null);
	let showPacks = $state(false);
	let showDelete = $state(false);
	let ruleToDelete = $state<AlertRule | null>(null);

	const orgId = $derived($currentOrganization?.id ?? null);

	// Scope: the project tab is pinned to its project, the global page follows the scope bar.
	const scopeIds = $derived.by<string[]>(() => {
		if (lockedProjectId) return [lockedProjectId];
		return readScopeFromUrl(page.url).projectIds ?? $scopeStore.projectIds;
	});

	// A create or edit link is cleaned up by the effect below; the scope bar must
	// not rewrite the same URL meanwhile.
	const canonicalScopeUrl = $derived.by(() => {
		const parsed = parseAlertPrefill(page.url);
		return !parsed.open && !parsed.editRuleId;
	});

	function inScope(projectId: string | null | undefined): boolean {
		if (projectId == null) return true;
		return scopeIds.length === 0 || scopeIds.includes(projectId);
	}

	// With exactly one project in scope the server filters history and detections,
	// so a quiet project is not buried under a busy one's newest 50 rows.
	const serverProjectId = $derived(scopeIds.length === 1 ? scopeIds[0] : null);

	const visibleRules = $derived(rules.filter((r) => inScope(r.projectId)));
	const visibleHistory = $derived(history.filter((h) => inScope(h.projectId)));
	const visibleDetections = $derived(detections.filter((d) => inScope(d.projectId)));
	const projectNames = $derived(Object.fromEntries(projects.map((p) => [p.id, p.name])));
	// Deep link from the command palette and elsewhere: ?rule=<id>.
	const ruleParam = $derived(page.url.searchParams.get('rule'));
	const highlightRuleId = $derived(
		ruleParam && visibleRules.some((r) => r.id === ruleParam) ? ruleParam : null
	);
	let scrolledTo = '';
	$effect(() => {
		const id = highlightRuleId;
		if (!id || loading || id === scrolledTo) return;
		scrolledTo = id;
		void tick().then(() => {
			const el = document.querySelector(`[data-rule-id="${CSS.escape(id)}"]`);
			const row = el?.closest('tr') ?? el;
			if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' });
		});
	});

	const hasMoreHistory = $derived(history.length < historyTotal);

	// Newest request wins: an older organization's response never overwrites a newer one.
	let seq = 0;

	async function loadAll(id: string) {
		const mine = ++seq;
		const pid = serverProjectId;
		loading = true;
		loadError = '';
		try {
			const [rulesRes, historyRes, detectionsRes, projectsRes, channelsRes] = await Promise.allSettled([
				alertsAPI.getAlertRules(id),
				alertsAPI.getAlertHistory(id, { limit: HISTORY_PAGE, ...(pid ? { projectId: pid } : {}) }),
				getRecentDetections({
					organizationId: id,
					...(pid ? { projectId: pid } : {}),
					category: ['reliability', 'database', 'business'],
					limit: HISTORY_PAGE,
				}),
				projectsAPI.getProjects(id),
				notificationChannelsAPI.list(id),
			]);
			if (mine !== seq) return;
			if (rulesRes.status === 'rejected') {
				loadError =
					rulesRes.reason instanceof Error ? rulesRes.reason.message : 'Could not load alert rules';
				rules = [];
			} else {
				rules = rulesRes.value.alertRules ?? [];
			}
			if (historyRes.status === 'fulfilled') {
				history = historyRes.value.history ?? [];
				historyTotal = historyRes.value.total ?? history.length;
			} else {
				history = [];
				historyTotal = 0;
			}
			detections = detectionsRes.status === 'fulfilled' ? (detectionsRes.value.detections ?? []) : [];
			projects =
				projectsRes.status === 'fulfilled'
					? projectsRes.value.projects.map((p) => ({ id: p.id, name: p.name }))
					: [];
			channelNames =
				channelsRes.status === 'fulfilled'
					? Object.fromEntries(channelsRes.value.map((c) => [c.id, `${c.type}: ${c.name}`]))
					: {};
			loadedOrg = id;
			loadedProject = pid;
		} finally {
			if (mine === seq) loading = false;
		}
	}

	// The scope narrowed to (or away from) one project: reload what the server filters.
	async function reloadScoped(id: string, pid: string | null) {
		const mine = ++seq;
		loadedProject = pid;
		const [historyRes, detectionsRes] = await Promise.allSettled([
			alertsAPI.getAlertHistory(id, { limit: HISTORY_PAGE, ...(pid ? { projectId: pid } : {}) }),
			getRecentDetections({
				organizationId: id,
				...(pid ? { projectId: pid } : {}),
				category: ['reliability', 'database', 'business'],
				limit: HISTORY_PAGE,
			}),
		]);
		if (mine !== seq) return;
		if (historyRes.status === 'fulfilled') {
			history = historyRes.value.history ?? [];
			historyTotal = historyRes.value.total ?? history.length;
		} else {
			history = [];
			historyTotal = 0;
		}
		detections = detectionsRes.status === 'fulfilled' ? (detectionsRes.value.detections ?? []) : [];
	}

	$effect(() => {
		const pid = serverProjectId;
		const id = orgId;
		if (!id || id !== loadedOrg || pid === untrack(() => loadedProject)) return;
		untrack(() => void reloadScoped(id, pid));
	});

	$effect(() => {
		const id = orgId;
		if (!id) {
			seq++;
			rules = [];
			history = [];
			detections = [];
			historyTotal = 0;
			loadedOrg = null;
			return;
		}
		if (id === untrack(() => loadedOrg)) return;
		rules = [];
		history = [];
		detections = [];
		untrack(() => void loadAll(id));
	});

	async function loadMoreHistory() {
		if (!orgId || loadingMore) return;
		const id = orgId;
		loadingMore = true;
		try {
			const res = await alertsAPI.getAlertHistory(id, {
				limit: HISTORY_PAGE,
				offset: history.length,
				...(loadedProject ? { projectId: loadedProject } : {}),
			});
			if (id !== orgId) return;
			history = [...history, ...(res.history ?? [])];
			historyTotal = res.total ?? historyTotal;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not load more history');
		} finally {
			loadingMore = false;
		}
	}

	// ?create=1&..., legacy ?new=1 and ?edit=<id>: open the dialog, then clean the URL.
	let handledUrl = '';
	$effect(() => {
		const url = page.url;
		const ready = loadedOrg !== null && !loading;
		const key = url.search;
		if (key === handledUrl) return;
		const parsed = parseAlertPrefill(url);
		if (!parsed.open && !parsed.editRuleId) {
			handledUrl = key;
			return;
		}
		// Edit links need the rules; create links can open right away.
		if (!parsed.open && !ready) return;
		handledUrl = key;
		untrack(() => {
			if (parsed.open) {
				createPrefill = lockedProjectId
					? { ...(parsed.prefill ?? {}), projectId: lockedProjectId }
					: parsed.prefill;
				showCreate = true;
			} else if (parsed.editRuleId) {
				const rule = rules.find((r) => r.id === parsed.editRuleId);
				if (rule) {
					ruleToEdit = rule;
					showEdit = true;
				} else {
					toastStore.error('Alert rule not found');
				}
			}
			void goto(stripPrefillParams(url), { replaceState: true, keepFocus: true, noScroll: true });
		});
	});

	function openCreate() {
		createPrefill = lockedProjectId ? { projectId: lockedProjectId } : undefined;
		showCreate = true;
	}

	function duplicate(rule: AlertRule) {
		createPrefill = {
			name: `${rule.name} (copy)`,
			projectId: lockedProjectId ?? rule.projectId,
			service: rule.service,
			levels: rule.level,
			query: rule.query ?? undefined,
			renotifyMinutes: rule.renotifyMinutes ?? null,
			threshold: rule.threshold,
			timeWindow: rule.timeWindow,
			alertType: rule.alertType,
			baselineType: rule.baselineType,
			deviationMultiplier: rule.deviationMultiplier,
			minBaselineValue: rule.minBaselineValue,
			cooldownMinutes: rule.cooldownMinutes,
			sustainedMinutes: rule.sustainedMinutes,
			metadataFilters: rule.metadataFilters,
			channelIds: rule.channelIds,
		};
		showCreate = true;
	}

	function edit(rule: AlertRule) {
		ruleToEdit = rule;
		showEdit = true;
	}

	function askDelete(rule: AlertRule) {
		ruleToDelete = rule;
		showDelete = true;
	}

	function patchRow(updated: AlertRule) {
		rules = rules.map((r) => (r.id === updated.id ? { ...r, ...updated } : r));
	}

	async function withBusy(id: string, run: () => Promise<void>) {
		busyIds = [...busyIds, id];
		try {
			await run();
		} finally {
			busyIds = busyIds.filter((b) => b !== id);
		}
	}

	async function toggle(rule: AlertRule) {
		if (!orgId) return;
		const id = orgId;
		await withBusy(rule.id, async () => {
			try {
				const res = await alertsAPI.updateAlertRule(id, rule.id, { enabled: !rule.enabled });
				patchRow(res.alertRule);
				toastStore.success(rule.enabled ? 'Alert disabled' : 'Alert enabled');
			} catch (e) {
				toastStore.error(e instanceof Error ? e.message : 'Could not update the alert');
			}
		});
	}

	async function snooze(rule: AlertRule, untilIso: string) {
		if (!orgId) return;
		const id = orgId;
		await withBusy(rule.id, async () => {
			try {
				const res = await alertsAPI.snoozeAlertRule(id, rule.id, untilIso);
				patchRow(res.alertRule);
				toastStore.success('Alert snoozed');
			} catch (e) {
				toastStore.error(e instanceof Error ? e.message : 'Could not snooze the alert');
			}
		});
	}

	async function unsnooze(rule: AlertRule) {
		if (!orgId) return;
		const id = orgId;
		await withBusy(rule.id, async () => {
			try {
				const res = await alertsAPI.unsnoozeAlertRule(id, rule.id);
				patchRow(res.alertRule);
				toastStore.success('Alert unsnoozed');
			} catch (e) {
				toastStore.error(e instanceof Error ? e.message : 'Could not unsnooze the alert');
			}
		});
	}

	async function confirmDelete() {
		const rule = ruleToDelete;
		if (!rule || !orgId) return;
		try {
			await alertsAPI.deleteAlertRule(rule.id, orgId);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not delete the alert');
			// Rethrow so the dialog stays open and the row stays in the list.
			throw e;
		}
		rules = rules.filter((r) => r.id !== rule.id);
		toastStore.success('Alert rule deleted');
	}

	function reloadRules() {
		if (orgId) void loadAll(orgId);
	}

	const projectLabelFor = (id: string | null) => (id ? (projectNames[id] ?? 'this project') : '');
</script>

{#snippet createButton()}
	<Button class="gap-2" onclick={openCreate}>
		<Plus class="w-4 h-4" aria-hidden="true" />
		Create alert
	</Button>
{/snippet}

{#snippet body()}
	{#if loadError && !loading}
		<EmptyState variant="error" title="Could not load alert rules" description={loadError}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={reloadRules}>Retry</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<Tabs value="rules" class="space-y-4">
			<TabsList>
				<TabsTrigger value="rules">Rules</TabsTrigger>
				<TabsTrigger value="history">History</TabsTrigger>
			</TabsList>

			<TabsContent value="rules" class="space-y-4">
				<AlertRulesTable
					rules={visibleRules}
					{history}
					{projectNames}
					{channelNames}
					{highlightRuleId}
					{loading}
					{busyIds}
					onToggle={toggle}
					onEdit={edit}
					onDuplicate={duplicate}
					onDelete={askDelete}
					onSnooze={snooze}
					onUnsnooze={unsnooze}
				>
					{#snippet empty()}
					<EmptyState
						variant="no-data"
						title="No alert rules"
						description={lockedProjectId
							? `Create a rule to be notified when logs in ${projectLabelFor(lockedProjectId)} cross a threshold.`
							: 'Create a rule to be notified when logs cross a threshold or change sharply.'}
					>
						{#snippet actions()}
							<Button onclick={openCreate}>Create alert</Button>
							<Button variant="outline" href="/dashboard/security/rules">Open detection rules</Button>
						{/snippet}
					</EmptyState>
					{/snippet}
				</AlertRulesTable>
			</TabsContent>

			<TabsContent value="history" class="space-y-4">
				<AlertHistoryTable
					alerts={visibleHistory}
					detections={visibleDetections}
					{rules}
					{projectNames}
					{loading}
					hasMore={hasMoreHistory && !loadingMore}
					onLoadMore={loadMoreHistory}
				/>
			</TabsContent>
		</Tabs>
	{/if}
{/snippet}

{#if embedded}
	<div class="space-y-4" data-testid="alerts-workspace-embedded">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-sm text-muted-foreground">
				Detection rules live in
				<a href="/dashboard/security/rules" class="underline underline-offset-2">Security &gt; Rules</a>.
			</p>
			<div class="flex items-center gap-2">
				{@render createButton()}
			</div>
		</div>
		{@render body()}
	</div>
{:else}
	<PageHeader
		title="Alerts"
		description="Get notified when logs cross a threshold or change sharply."
		appliesTo="organization"
	>
		{#snippet actions()}
			<ScopeBar mode="multi" {projects} showTime={false} canonicalUrl={canonicalScopeUrl} />
			<Button variant="outline" class="gap-2" onclick={() => (showPacks = true)}>
				<Package class="w-4 h-4" aria-hidden="true" />
				Detection packs
			</Button>
			{@render createButton()}
		{/snippet}
	</PageHeader>
	<div class="space-y-4">
		{@render body()}
	</div>
{/if}

{#if orgId}
	<DetectionPacksGalleryDialog
		bind:open={showPacks}
		organizationId={orgId}
		categories={['reliability', 'database', 'business']}
	/>
	<CreateAlertDialog
		bind:open={showCreate}
		organizationId={orgId}
		projectId={lockedProjectId}
		initialValues={createPrefill}
		{projects}
		onSuccess={reloadRules}
	/>
	<EditAlertDialog
		bind:open={showEdit}
		organizationId={orgId}
		alert={ruleToEdit}
		{projects}
		onSuccess={reloadRules}
	/>
{/if}

<ConfirmDialog
	bind:open={showDelete}
	title="Delete alert rule"
	description={ruleToDelete
		? `This permanently deletes "${ruleToDelete.name}" and stops its notifications. Past alerts stay in History.`
		: undefined}
	confirmLabel="Delete"
	onConfirm={confirmDelete}
/>
