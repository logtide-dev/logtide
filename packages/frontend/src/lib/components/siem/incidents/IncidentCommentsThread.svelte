<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Textarea } from '$lib/components/ui/textarea';
	import { addIncidentComment, type IncidentComment } from '$lib/api/siem';
	import { toastStore } from '$lib/stores/toast';
	import EmptyStateSiem from '../shared/EmptyStateSiem.svelte';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Send from '@lucide/svelte/icons/send';
	import User from '@lucide/svelte/icons/user';
	import Clock from '@lucide/svelte/icons/clock';
	import Loader2 from '@lucide/svelte/icons/loader-2';

	interface Props {
		comments: IncidentComment[];
		incidentId: string;
		organizationId: string;
		onCommentAdded?: (comment: IncidentComment) => void;
	}

	let { comments, incidentId, organizationId, onCommentAdded }: Props = $props();

	let newComment = $state('');
	let submitting = $state(false);

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString('it-IT', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	function formatTimeAgo(dateStr: string): string {
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) {
			return 'Just now';
		} else if (diffMins < 60) {
			return `${diffMins}m ago`;
		} else if (diffHours < 24) {
			return `${diffHours}h ago`;
		} else {
			return `${diffDays}d ago`;
		}
	}

	async function handleSubmit() {
		if (!newComment.trim()) return;

		submitting = true;
		try {
			const comment = await addIncidentComment(incidentId, organizationId, newComment.trim());
			newComment = '';
			onCommentAdded?.(comment);
			toastStore.success('Comment added');
		} catch (error) {
			toastStore.error(error instanceof Error ? error.message : 'Failed to add comment');
		} finally {
			submitting = false;
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			handleSubmit();
		}
	}
</script>

<Card>
	<CardHeader class="pb-3">
		<CardTitle class="text-base font-semibold flex items-center gap-2">
			<MessageSquare class="w-4 h-4" />
			Comments
			<span class="text-muted-foreground font-normal">({comments.length})</span>
		</CardTitle>
	</CardHeader>
	<CardContent class="space-y-4">
		{#if comments.length === 0}
			<div class="text-center py-6 text-muted-foreground">
				<MessageSquare class="w-8 h-8 mx-auto mb-2 opacity-50" />
				<p class="text-sm">No comments yet</p>
				<p class="text-xs">Be the first to add a comment</p>
			</div>
		{:else}
			<div class="space-y-4 max-h-[400px] overflow-y-auto pr-2">
				{#each comments as comment}
					<div class="flex gap-3">
						<!-- Avatar -->
						<div
							class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0"
						>
							<User class="w-4 h-4 text-primary" />
						</div>

						<!-- Content -->
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 mb-1">
								<span class="font-medium text-sm">
									{comment.userName || 'Unknown user'}
								</span>
								<span
									class="text-xs text-muted-foreground"
									title={formatDate(comment.createdAt)}
								>
									{formatTimeAgo(comment.createdAt)}
								</span>
								{#if comment.edited}
									<span class="text-xs text-muted-foreground">(edited)</span>
								{/if}
							</div>
							<p class="text-sm text-foreground whitespace-pre-wrap break-words">
								{comment.comment}
							</p>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Add Comment Form -->
		<div class="border-t pt-4">
			<div class="flex gap-3">
				<div
					class="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0"
				>
					<User class="w-4 h-4 text-primary-foreground" />
				</div>
				<div class="flex-1 space-y-2">
					<Textarea
						placeholder="Add a comment... (Ctrl+Enter to submit)"
						bind:value={newComment}
						onkeydown={handleKeyDown}
						rows={3}
						class="resize-none"
						disabled={submitting}
					/>
					<div class="flex justify-end">
						<Button
							size="sm"
							onclick={handleSubmit}
							disabled={!newComment.trim() || submitting}
						>
							{#if submitting}
								<Loader2 class="w-4 h-4 mr-2 animate-spin" />
								Posting...
							{:else}
								<Send class="w-4 h-4 mr-2" />
								Post Comment
							{/if}
						</Button>
					</div>
				</div>
			</div>
		</div>
	</CardContent>
</Card>
