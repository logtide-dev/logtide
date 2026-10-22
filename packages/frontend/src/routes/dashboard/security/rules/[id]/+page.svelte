<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { DetectionEvent, SigmaRuleDetail } from '@logtide/shared';
  import { currentOrganization } from '$lib/stores/organization';
  import { sigmaAPI, SigmaApiError, type SigmaRule } from '$lib/api/sigma';
  import { toastStore } from '$lib/stores/toast';
  import { layoutStore } from '$lib/stores/layout';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import Spinner from '$lib/components/Spinner.svelte';
  import MitreTacticBadge from '$lib/components/siem/shared/MitreTacticBadge.svelte';
  import MitreTechniqueBadge from '$lib/components/siem/shared/MitreTechniqueBadge.svelte';
  import RuleYamlPanel from '$lib/components/siem/rules/RuleYamlPanel.svelte';
  import RulePreviewPanel from '$lib/components/siem/rules/RulePreviewPanel.svelte';
  import RuleExceptionsPanel from '$lib/components/siem/rules/RuleExceptionsPanel.svelte';
  import WillNotify from '$lib/components/notification-channels/WillNotify.svelte';
  import EditSigmaChannelsDialog from '$lib/components/EditSigmaChannelsDialog.svelte';
  import { notificationChannelsAPI } from '$lib/api/notification-channels';
  import RuleMatchesTable from '$lib/components/siem/rules/RuleMatchesTable.svelte';
  import { sourceLabel } from '$lib/components/siem/rules/rule-source';
  import { extractReferences } from '$lib/components/siem/rules/yaml-references';
  import { referenceLabel } from '$lib/components/siem/shared/reference-label';

  const MATCH_PAGE_SIZE = 20;

  let rule = $state<SigmaRuleDetail | null>(null);
  let loading = $state(false);
  let notFound = $state(false);
  let error = $state('');

  let matches = $state<DetectionEvent[]>([]);
  let matchesTotal = $state(0);
  let matchesLoading = $state(false);

  let yamlEditing = $state(false);
  let draftYaml = $state<string | null>(null);
  let toggling = $state(false);
  let showDelete = $state(false);
  let showChannels = $state(false);
  let channelIds = $state<string[]>([]);

  let maxWidthClass = $state('max-w-7xl');
  let containerPadding = $state('px-6 py-8');

  $effect(() => layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v)));
  $effect(() => layoutStore.containerPadding.subscribe((v) => (containerPadding = v)));

  const ruleId = $derived(page.params.id ?? '');
  const references = $derived(rule ? extractReferences(rule.yaml) : []);

  let loadSequence = 0;

  async function loadRule(id: string, orgId: string, keepCurrent = false) {
    const current = ++loadSequence;
    loading = true;
    error = '';
    notFound = false;
    if (!keepCurrent) {
      // Navigating between rules must never show the previous rule's data.
      rule = null;
      matches = [];
      matchesTotal = 0;
      yamlEditing = false;
    }
    try {
      const res = await sigmaAPI.getRuleDetail(id, orgId);
      if (current !== loadSequence) return;
      rule = res.rule;
    } catch (e) {
      if (current !== loadSequence) return;
      if (e instanceof SigmaApiError && e.status === 404) notFound = true;
      else error = e instanceof Error ? e.message : 'Failed to load rule';
    } finally {
      if (current === loadSequence) loading = false;
    }
  }

  let matchSequence = 0;

  async function loadMatches(id: string, orgId: string, offset = 0) {
    const current = ++matchSequence;
    matchesLoading = true;
    try {
      const res = await sigmaAPI.getMatches(id, orgId, { limit: MATCH_PAGE_SIZE, offset, days: 7 });
      if (current !== matchSequence) return;
      matches = res.matches;
      matchesTotal = res.total;
    } catch {
      if (current !== matchSequence) return;
      matches = [];
      matchesTotal = 0;
    } finally {
      if (current === matchSequence) matchesLoading = false;
    }
  }

  async function loadChannels(id: string) {
    try {
      const channels = await notificationChannelsAPI.getSigmaRuleChannels(id);
      if (rule?.id === id) channelIds = channels.map((c) => c.id);
    } catch {
      channelIds = [];
    }
  }

  const loadedRuleId = $derived(rule?.id);

  $effect(() => {
    const rid = loadedRuleId;
    if (!browser || !rid) return;
    channelIds = [];
    loadChannels(rid);
  });

  $effect(() => {
    const id = ruleId;
    const org = $currentOrganization;
    if (!browser || !org || !id) return;
    loadRule(id, org.id);
    loadMatches(id, org.id);
  });

  async function toggleEnabled(enabled: boolean) {
    const org = $currentOrganization;
    if (!org || !rule) return;
    const previous = rule.enabled;
    rule = { ...rule, enabled };
    toggling = true;
    try {
      await sigmaAPI.updateRule(rule.id, { organizationId: org.id, enabled });
    } catch (e) {
      if (rule) rule = { ...rule, enabled: previous };
      toastStore.error(e instanceof Error ? e.message : 'Failed to update rule');
    } finally {
      toggling = false;
    }
  }

  async function deleteRule() {
    const org = $currentOrganization;
    if (!org || !rule) return;
    try {
      await sigmaAPI.deleteRule(rule.id, org.id, true);
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to delete rule');
      throw e;
    }
    toastStore.success('Rule deleted');
    goto('/dashboard/security/rules');
  }

  function openYamlEditor() {
    yamlEditing = true;
    document.getElementById('rule-yaml')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function reloadAfterSave() {
    const org = $currentOrganization;
    if (org && rule) loadRule(rule.id, org.id, true);
  }
</script>

<svelte:head>
  <title>{rule ? `${rule.title} - Detection rules` : 'Detection rule'} - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  {#if notFound}
    <EmptyState
      variant="no-results"
      title="Rule not found"
      description="This rule may have been deleted, or it belongs to another organization."
    >
      {#snippet actions()}
        <Button variant="outline" href="/dashboard/security/rules">Back to detection rules</Button>
      {/snippet}
    </EmptyState>
  {:else if error}
    <EmptyState variant="error" title="Could not load the rule" description={error}>
      {#snippet actions()}
        <Button
          variant="outline"
          onclick={() => $currentOrganization && loadRule(ruleId, $currentOrganization.id)}
        >
          Retry
        </Button>
      {/snippet}
    </EmptyState>
  {:else if !rule}
    <div class="flex items-center justify-center py-16" aria-busy={loading}>
      <Spinner />
      <span class="ml-3 text-muted-foreground">Loading rule</span>
    </div>
  {:else}
    <PageHeader
      title={rule.title}
      breadcrumbs={[
        { label: 'Security', href: '/dashboard/security' },
        { label: 'Detection rules', href: '/dashboard/security/rules' },
        { label: rule.title },
      ]}
    >
      {#snippet meta()}
        <SeverityBadge kind="severity" value={rule!.level} />
        <span class="text-sm text-muted-foreground">{sourceLabel(rule!)}</span>
        {#if rule!.status}
          <span class="text-sm text-muted-foreground">{rule!.status}</span>
        {/if}
        <Switch
          checked={rule!.enabled}
          disabled={toggling}
          aria-label="Enable {rule!.title}"
          onCheckedChange={toggleEnabled}
        />
      {/snippet}
      {#snippet actions()}
        {#if rule!.editable}
          <Button variant="outline" onclick={openYamlEditor}>Edit YAML</Button>
        {/if}
        <Button variant="destructive" onclick={() => (showDelete = true)}>Delete rule</Button>
      {/snippet}
    </PageHeader>

    <div class="space-y-10">
      <section aria-labelledby="rule-overview" class="space-y-4">
        <h2 id="rule-overview" class="text-lg font-semibold">Overview</h2>
        {#if rule.description}
          <p class="max-w-3xl text-sm">{rule.description}</p>
        {/if}
        <dl class="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt class="text-muted-foreground">Author</dt>
            <dd>{rule.author ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Date</dt>
            <dd>{rule.date ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Hits (7d)</dt>
            <dd class="tabular-nums">{rule.hits7d.toLocaleString('en-US')}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Last fired</dt>
            <dd>
              {#if rule.lastFiredAt}
                <Timestamp value={rule.lastFiredAt} precision="second" />
              {:else}
                Never
              {/if}
            </dd>
          </div>
        </dl>
        {#if (rule.mitreTactics?.length ?? 0) > 0 || (rule.mitreTechniques?.length ?? 0) > 0}
          <div class="flex flex-wrap items-center gap-2">
            {#each rule.mitreTactics ?? [] as tactic (tactic)}
              <MitreTacticBadge {tactic} />
            {/each}
            {#each rule.mitreTechniques ?? [] as technique (technique)}
              <MitreTechniqueBadge {technique} compact />
            {/each}
          </div>
        {/if}
        {#if references.length > 0}
          <div>
            <h3 class="mb-1 text-sm text-muted-foreground">References</h3>
            <ul class="space-y-1 text-sm">
              {#each references as url (url)}
                <li>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="underline underline-offset-2 hover:text-foreground"
                  >
                    {referenceLabel(url)}
                  </a>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </section>

      <section id="rule-yaml" aria-labelledby="rule-yaml-title" class="space-y-3">
        <h2 id="rule-yaml-title" class="text-lg font-semibold">YAML</h2>
        <RuleYamlPanel
          yaml={rule.yaml}
          reconstructed={rule.yamlReconstructed}
          editable={rule.editable}
          organizationId={rule.organizationId}
          ruleId={rule.id}
          bind:editing={yamlEditing}
          bind:draft={draftYaml}
          onSaved={reloadAfterSave}
        />
      </section>

      <section aria-labelledby="rule-matches" class="space-y-3">
        <h2 id="rule-matches" class="text-lg font-semibold">Recent matches</h2>
        <RuleMatchesTable
          {matches}
          total={matchesTotal}
          loading={matchesLoading}
          pageSize={MATCH_PAGE_SIZE}
          onPage={(offset) => $currentOrganization && loadMatches(rule!.id, $currentOrganization.id, offset)}
        />
      </section>
      <section aria-labelledby="rule-preview" class="space-y-3">
        <h2 id="rule-preview" class="text-lg font-semibold">Preview on history</h2>
        <p class="text-sm text-muted-foreground">
          Run this rule against recent logs to see what it would have matched.
          {#if draftYaml}Unsaved YAML edits are used for the preview.{/if}
        </p>
        <RulePreviewPanel
          organizationId={rule.organizationId}
          ruleId={rule.id}
          getDraftYaml={() => draftYaml}
        />
      </section>

      <section aria-labelledby="rule-exceptions" class="space-y-3">
        <h2 id="rule-exceptions" class="text-lg font-semibold">Exceptions</h2>
        <RuleExceptionsPanel organizationId={rule.organizationId} ruleId={rule.id} ruleTitle={rule.title} />
      </section>

      <section aria-labelledby="rule-destinations" class="space-y-3">
        <h2 id="rule-destinations" class="text-lg font-semibold">Destinations</h2>
        <WillNotify eventType="sigma" projectId={rule.projectId} {channelIds} />
        <Button variant="outline" onclick={() => (showChannels = true)}>Edit destinations</Button>
      </section>
    </div>
  {/if}
</div>

{#if rule}
  <EditSigmaChannelsDialog
    bind:open={showChannels}
    rule={rule as unknown as SigmaRule}
    onSuccess={() => rule && loadChannels(rule.id)}
  />
{/if}

<ConfirmDialog
  bind:open={showDelete}
  title="Delete rule"
  description={rule
    ? `Delete "${rule.title}"? Its exceptions and the linked alert rule are removed too. This cannot be undone.`
    : ''}
  confirmLabel="Delete rule"
  onConfirm={deleteRule}
/>
