<script lang="ts">
  import { sigmaAPI, type CategoryTreeNode, type SigmaRuleMetadata } from '$lib/api/sigma';
  import { Input } from '$lib/components/ui/input';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Badge } from '$lib/components/ui/badge';
  import {
    ChevronRight,
    ChevronDown,
    Folder,
    FileText,
    Loader2,
    Search,
  } from '@lucide/svelte';

  interface Props {
    onSelectionChange: (selection: { categories: string[]; rules: string[] }) => void;
  }

  let { onSelectionChange }: Props = $props();

  let tree = $state<CategoryTreeNode[]>([]);
  let searchQuery = $state('');
  let searchResults = $state<SigmaRuleMetadata[]>([]);

  let expandedNodes = $state<Set<string>>(new Set());
  let loadedRules = $state<Map<string, SigmaRuleMetadata[]>>(new Map());
  let loadingNodes = $state<Set<string>>(new Set());

  let selectedCategories = $state<Set<string>>(new Set());
  let selectedRules = $state<Set<string>>(new Set());

  let loading = $state(false);
  let searching = $state(false);
  let error = $state('');

  $effect(() => {
    loadTree();
  });

  async function loadTree() {
    loading = true;
    error = '';
    try {
      const response = await sigmaAPI.getCategoryTree();
      tree = response.tree;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load tree';
    }
    loading = false;
  }

  async function toggleNode(node: CategoryTreeNode) {
    const path = node.path;

    if (expandedNodes.has(path)) {
      expandedNodes.delete(path);
    } else {
      expandedNodes.add(path);

      if (!loadedRules.has(path)) {
        loadingNodes.add(path);
        try {
          const response = await sigmaAPI.getRulesForCategory(path, true);
          loadedRules.set(path, response.rules);
        } catch (err) {
          console.error('Failed to load rules:', err);
        }
        loadingNodes.delete(path);
      }
    }

    expandedNodes = new Set(expandedNodes);
    loadingNodes = new Set(loadingNodes);
  }

  function toggleCategory(path: string) {
    if (selectedCategories.has(path)) {
      selectedCategories.delete(path);
    } else {
      selectedCategories.add(path);
    }
    selectedCategories = new Set(selectedCategories);
    notifySelectionChange();
  }

  function toggleRule(rulePath: string) {
    if (selectedRules.has(rulePath)) {
      selectedRules.delete(rulePath);
    } else {
      selectedRules.add(rulePath);
    }
    selectedRules = new Set(selectedRules);
    notifySelectionChange();
  }

  function notifySelectionChange() {
    onSelectionChange({
      categories: Array.from(selectedCategories),
      rules: Array.from(selectedRules),
    });
  }

  let searchTimeout: number;
  $effect(() => {
    if (searchQuery.length >= 2) {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        performSearch();
      }, 500) as unknown as number;
    } else {
      searchResults = [];
    }
  });

  async function performSearch() {
    searching = true;
    try {
      const response = await sigmaAPI.searchRules(searchQuery);
      searchResults = response.results;
    } catch (err) {
      console.error('Search failed:', err);
      searchResults = [];
    }
    searching = false;
  }

  const totalSelected = $derived(selectedCategories.size + selectedRules.size);
</script>

<div class="flex flex-col gap-4">
  <div class="relative">
    <Search class="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
    <Input
      type="text"
      placeholder="Search rules by name..."
      bind:value={searchQuery}
      class="pl-9"
    />
  </div>

  {#if totalSelected > 0}
    <div class="flex items-center justify-between">
      <Badge variant="secondary">
        {totalSelected.toLocaleString('en-US')} item{totalSelected === 1 ? '' : 's'} selected
      </Badge>
      <button
        type="button"
        class="text-xs text-muted-foreground hover:text-foreground"
        onclick={() => {
          selectedCategories.clear();
          selectedRules.clear();
          selectedCategories = new Set(selectedCategories);
          selectedRules = new Set(selectedRules);
          notifySelectionChange();
        }}
      >
        Clear selection
      </button>
    </div>
  {/if}

  <div class="max-h-[500px] overflow-y-auto border rounded-md p-2">
    {#if loading}
      <div class="flex items-center justify-center p-8">
        <Loader2 class="h-6 w-6 animate-spin" />
      </div>
    {:else if error}
      <div class="text-sm text-destructive p-4">{error}</div>
    {:else if searchQuery.length >= 2}
      {#if searching}
        <div class="flex items-center justify-center p-8">
          <Loader2 class="h-4 w-4 animate-spin" />
        </div>
      {:else if searchResults.length === 0}
        <div class="text-sm text-muted-foreground p-4">No results found</div>
      {:else}
        <div class="space-y-1">
          {#each searchResults as result}
            <div class="flex items-center gap-2 p-2 hover:bg-muted/50 rounded-md transition-colors">
              <Checkbox
                checked={selectedRules.has(result.path)}
                onCheckedChange={() => toggleRule(result.path)}
              />
              <FileText class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm flex-1 truncate" title={result.title || result.name}>
                {result.title || result.name}
              </span>
              {#if result.level}
                <Badge variant="outline" class="text-xs">{result.level}</Badge>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <div class="space-y-0.5">
        {#if tree.length === 0}
          <div class="text-sm text-muted-foreground p-4">No categories available</div>
        {:else}
          {#each tree as node}
            {@render TreeNode({ node, level: 0 })}
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>

{#snippet TreeNode(props: { node: CategoryTreeNode; level: number })}
  <div>
    <div
      class="flex items-center gap-2 p-2 hover:bg-muted/50 rounded-md cursor-pointer transition-colors"
      style="padding-left: {props.level * 1.5 + 0.5}rem"
    >
      <button type="button" onclick={() => toggleNode(props.node)} class="shrink-0">
        {#if expandedNodes.has(props.node.path)}
          <ChevronDown class="h-4 w-4" />
        {:else}
          <ChevronRight class="h-4 w-4" />
        {/if}
      </button>

      <Checkbox
        checked={selectedCategories.has(props.node.path)}
        onCheckedChange={() => toggleCategory(props.node.path)}
      />

      <Folder class="h-4 w-4 text-muted-foreground shrink-0" />

      <span class="text-sm flex-1 truncate" title={props.node.name}>{props.node.name}</span>
      <Badge variant="outline" class="text-xs shrink-0">
        {props.node.ruleCount}
      </Badge>

      {#if loadingNodes.has(props.node.path)}
        <Loader2 class="h-4 w-4 animate-spin shrink-0" />
      {/if}
    </div>

    {#if expandedNodes.has(props.node.path)}
      {#if props.node.children && props.node.children.length > 0}
        {#each props.node.children as child}
          {@render TreeNode({ node: child, level: props.level + 1 })}
        {/each}
      {/if}

      {#if loadedRules.has(props.node.path)}
        {@const rules = loadedRules.get(props.node.path) || []}
        {#each rules as rule}
          <div
            class="flex items-center gap-2 p-2 hover:bg-muted/50 rounded-md transition-colors"
            style="padding-left: {(props.level + 1) * 1.5 + 0.5}rem"
          >
            <div class="w-4 shrink-0"></div>
            <Checkbox
              checked={selectedRules.has(rule.path)}
              onCheckedChange={() => toggleRule(rule.path)}
            />
            <FileText class="h-4 w-4 text-muted-foreground shrink-0" />
            <span class="text-sm flex-1 truncate" title={rule.title || rule.name}>
              {rule.title || rule.name}
            </span>
            {#if rule.level}
              <Badge variant="outline" class="text-xs shrink-0">{rule.level}</Badge>
            {/if}
          </div>
        {/each}
      {/if}
    {/if}
  </div>
{/snippet}
