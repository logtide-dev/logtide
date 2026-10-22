<script lang="ts">
	import type { OrganizationMemberWithUser } from '@logtide/shared';
	import type { IncidentComment } from '@logtide/shared';
	import { incidentsAPI } from '$lib/api/incidents';
	import { toastStore } from '$lib/stores/toast';
	import { levelTone } from '$lib/utils/severity';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Textarea } from '$lib/components/ui/textarea';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import Timestamp from '$lib/components/app/Timestamp.svelte';
	import KeyValueTable from '$lib/components/app/KeyValueTable.svelte';
	import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import Bell from '@lucide/svelte/icons/bell';
	import Activity from '@lucide/svelte/icons/activity';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import History from '@lucide/svelte/icons/history';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import {
		buildTraceUrl,
		describeHistoryEntry,
		type TimelineEntry,
	} from './incident-model';

	interface Props {
		entries: TimelineEntry[];
		members: OrganizationMemberWithUser[];
		organizationId: string;
		incidentId: string;
		onCommentAdded: (comment: IncidentComment) => void;
	}

	let { entries, members, organizationId, incidentId, onCommentAdded }: Props = $props();

	let draft = $state('');
	let submitting = $state(false);
	let expanded = $state<Record<string, boolean>>({});

	function toggle(id: string) {
		expanded = { ...expanded, [id]: !expanded[id] };
	}

	function authorOf(c: IncidentComment): { name: string; email?: string } {
		const member = members.find((m) => m.user.id === c.userId);
		const name = c.userName || member?.user.name || c.userEmail || 'Unknown user';
		return { name, email: c.userEmail || member?.user.email };
	}

	async function submit() {
		const text = draft.trim();
		if (!text || submitting) return;
		submitting = true;
		try {
			const comment = await incidentsAPI.addComment(incidentId, organizationId, text);
			draft = '';
			onCommentAdded(comment);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not add comment');
		} finally {
			submitting = false;
		}
	}
</script>

<section aria-label="Incident timeline" class="space-y-4">
	<div class="space-y-2">
		<label for="incident-comment" class="text-sm font-medium">Add a comment</label>
		<Textarea
			id="incident-comment"
			bind:value={draft}
			placeholder="Share what you found or what you are doing"
			rows={3}
			disabled={submitting}
		/>
		<div class="flex justify-end">
			<Button size="sm" onclick={submit} disabled={submitting || !draft.trim()}>
				Add comment
			</Button>
		</div>
	</div>

	{#if entries.length === 0}
		<p class="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
			Nothing has happened on this incident yet
		</p>
	{:else}
		<ol class="relative space-y-4 border-l border-border pl-6">
			{#each entries as entry (entry.id)}
				<li class="relative">
					<span
						class="absolute -left-[2.1rem] flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground"
						aria-hidden="true"
					>
						{#if entry.kind === 'detection'}
							<AlertTriangle class="size-4" />
						{:else if entry.kind === 'alert_trigger'}
							<Bell class="size-4" />
						{:else if entry.kind === 'monitor_check'}
							<Activity class="size-4" />
						{:else if entry.kind === 'comment'}
							<MessageSquare class="size-4" />
						{:else}
							<History class="size-4" />
						{/if}
					</span>

					{#if entry.kind === 'detection'}
						{@const d = entry.detection}
						<div class="rounded-lg border border-border bg-card p-3">
							<div class="flex flex-wrap items-center gap-2">
								<SeverityBadge kind="severity" value={d.severity} />
								<span class="text-sm font-medium">{d.ruleTitle}</span>
								<span class="font-mono text-xs text-muted-foreground">{d.service}</span>
								<span class="ml-auto text-xs text-muted-foreground">
									<Timestamp value={d.time} showZone />
								</span>
							</div>
							<button
								type="button"
								class="mt-2 inline-flex items-center gap-1 text-xs text-primary-text hover:underline"
								aria-expanded={!!expanded[entry.id]}
								onclick={() => toggle(entry.id)}
							>
								{#if expanded[entry.id]}
									<ChevronUp class="size-3.5" aria-hidden="true" />
									Hide details
								{:else}
									<ChevronDown class="size-3.5" aria-hidden="true" />
									Show details
								{/if}
							</button>
							{#if expanded[entry.id]}
								<div class="mt-3 space-y-3">
									<p class="rounded border border-border bg-background p-2 font-mono text-sm break-words">
										{d.logMessage}
									</p>
									<div class="flex flex-wrap items-center gap-3 text-xs">
										<span class="rounded-full px-2 py-0.5 font-medium uppercase {levelTone(d.logLevel).badge}">
											{d.logLevel}
										</span>
										{#if d.traceId}
											<a
												class="font-mono text-primary-text hover:underline"
												href={buildTraceUrl(d.traceId, d.projectId)}
											>
												Trace {d.traceId}
											</a>
										{/if}
										<a
											class="text-primary-text hover:underline"
											href={`/dashboard/logs?logId=${encodeURIComponent(d.logId)}${d.projectId ? `&project=${encodeURIComponent(d.projectId)}` : ''}`}
										>
											Open log
										</a>
									</div>
									{#if d.ruleDescription}
										<p class="text-xs text-muted-foreground">{d.ruleDescription}</p>
									{/if}
									{#if d.matchedFields && Object.keys(d.matchedFields).length > 0}
										<KeyValueTable data={d.matchedFields} />
									{/if}
								</div>
							{/if}
						</div>
					{:else if entry.kind === 'alert_trigger' || entry.kind === 'monitor_check'}
						<div class="rounded-lg border border-border bg-card p-3">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-sm font-medium">
									{entry.kind === 'alert_trigger' ? 'Alert triggered' : 'Monitor check failed'}
								</span>
								<span class="ml-auto text-xs text-muted-foreground">
									<Timestamp value={entry.event.time} showZone />
								</span>
							</div>
							<p class="mt-1 text-sm text-muted-foreground">{entry.event.summary}</p>
						</div>
					{:else if entry.kind === 'comment'}
						{@const author = authorOf(entry.comment)}
						<div class="rounded-lg border border-border bg-card p-3">
							<div class="flex items-center gap-2">
								<Avatar name={author.name} email={author.email} size="sm" />
								<span class="text-sm font-medium">{author.name}</span>
								<span class="ml-auto text-xs text-muted-foreground">
									<Timestamp value={entry.comment.createdAt} showZone />
								</span>
							</div>
							<p class="mt-2 whitespace-pre-wrap text-sm">{entry.comment.comment}</p>
						</div>
					{:else}
						<div class="flex flex-wrap items-center gap-2 py-1 text-sm">
							<span>{describeHistoryEntry(entry.entry)}</span>
							{#if entry.entry.userName}
								<span class="text-xs text-muted-foreground">by {entry.entry.userName}</span>
							{/if}
							<span class="ml-auto text-xs text-muted-foreground">
								<Timestamp value={entry.entry.createdAt} showZone />
							</span>
						</div>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</section>
