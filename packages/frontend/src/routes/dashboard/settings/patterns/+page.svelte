<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { toastStore } from '$lib/stores/toast';
  import { patternsAPI, type IdentifierPattern, type DefaultPattern } from '$lib/api/patterns';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Switch } from '$lib/components/ui/switch';
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from '$lib/components/ui/table';
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog';
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  } from '$lib/components/ui/alert-dialog';
  import Spinner from '$lib/components/Spinner.svelte';
  import Fingerprint from '@lucide/svelte/icons/fingerprint';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import FlaskConical from '@lucide/svelte/icons/flask-conical';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Lock from '@lucide/svelte/icons/lock';
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';

  let token: string | null = null;
  let currentOrg = $state<any>(null);

  let loading = $state(true);
  let customPatterns = $state<IdentifierPattern[]>([]);
  let defaultPatterns = $state<DefaultPattern[]>([]);

  // Dialog states
  let editDialogOpen = $state(false);
  let deleteDialogOpen = $state(false);
  let testDialogOpen = $state(false);

  // Form state
  let editingPattern = $state<IdentifierPattern | null>(null);
  let isCreating = $state(false);
  let saving = $state(false);
  let deleting = $state(false);

  // Form fields
  let formName = $state('');
  let formDisplayName = $state('');
  let formDescription = $state('');
  let formPattern = $state('');
  let formFieldNames = $state('');
  let formPriority = $state(50);
  let formEnabled = $state(true);

  // Test dialog state
  let testPattern = $state('');
  let testText = $state('');
  let testResults = $state<string[]>([]);
  let testing = $state(false);

  authStore.subscribe((state) => {
    token = state.token;
  });

  organizationStore.subscribe((state) => {
    currentOrg = state.currentOrganization;
  });

  onMount(async () => {
    if (!token) {
      goto('/login');
      return;
    }
    await loadPatterns();
  });

  async function loadPatterns() {
    loading = true;
    try {
      const data = await patternsAPI.listPatterns();
      customPatterns = data.custom;
      defaultPatterns = data.defaults;
    } catch (e) {
      console.error('Failed to load patterns:', e);
      toastStore.error('Failed to load identifier patterns');
    } finally {
      loading = false;
    }
  }

  function openCreateDialog() {
    isCreating = true;
    editingPattern = null;
    formName = '';
    formDisplayName = '';
    formDescription = '';
    formPattern = '';
    formFieldNames = '';
    formPriority = 50;
    formEnabled = true;
    editDialogOpen = true;
  }

  function openEditDialog(pattern: IdentifierPattern) {
    isCreating = false;
    editingPattern = pattern;
    formName = pattern.name;
    formDisplayName = pattern.displayName;
    formDescription = pattern.description || '';
    formPattern = pattern.pattern;
    formFieldNames = pattern.fieldNames.join(', ');
    formPriority = pattern.priority;
    formEnabled = pattern.enabled;
    editDialogOpen = true;
  }

  function openDeleteDialog(pattern: IdentifierPattern) {
    editingPattern = pattern;
    deleteDialogOpen = true;
  }

  function openTestDialog(pattern?: string) {
    testPattern = pattern || '';
    testText = '';
    testResults = [];
    testDialogOpen = true;
  }

  async function handleSave() {
    if (!formName || !formDisplayName || !formPattern) {
      toastStore.error('Please fill in all required fields');
      return;
    }

    // Validate pattern name format
    if (!/^[a-z][a-z0-9_]*$/.test(formName)) {
      toastStore.error('Pattern name must start with a letter and contain only lowercase letters, numbers, and underscores');
      return;
    }

    saving = true;
    try {
      const fieldNames = formFieldNames
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);

      if (isCreating) {
        await patternsAPI.createPattern({
          name: formName,
          displayName: formDisplayName,
          description: formDescription || undefined,
          pattern: formPattern,
          fieldNames,
          priority: formPriority,
          enabled: formEnabled,
        });
        toastStore.success('Pattern created successfully');
      } else if (editingPattern?.id) {
        await patternsAPI.updatePattern(editingPattern.id, {
          displayName: formDisplayName,
          description: formDescription || undefined,
          pattern: formPattern,
          fieldNames,
          priority: formPriority,
          enabled: formEnabled,
        });
        toastStore.success('Pattern updated successfully');
      }

      editDialogOpen = false;
      await loadPatterns();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to save pattern';
      toastStore.error(errorMsg);
    } finally {
      saving = false;
    }
  }

  async function handleDelete() {
    if (!editingPattern?.id) return;

    deleting = true;
    try {
      await patternsAPI.deletePattern(editingPattern.id);
      toastStore.success('Pattern deleted');
      deleteDialogOpen = false;
      editingPattern = null;
      await loadPatterns();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to delete pattern';
      toastStore.error(errorMsg);
    } finally {
      deleting = false;
    }
  }

  async function handleToggleEnabled(pattern: IdentifierPattern) {
    if (!pattern.id) return;

    try {
      await patternsAPI.updatePattern(pattern.id, {
        enabled: !pattern.enabled,
      });
      await loadPatterns();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to update pattern';
      toastStore.error(errorMsg);
    }
  }

  async function handleTest() {
    if (!testPattern || !testText) {
      toastStore.error('Please enter both a pattern and test text');
      return;
    }

    testing = true;
    try {
      const result = await patternsAPI.testPattern(testPattern, testText);
      testResults = result.matches;
      if (result.count === 0) {
        toastStore.info('No matches found');
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Invalid regex pattern';
      toastStore.error(errorMsg);
      testResults = [];
    } finally {
      testing = false;
    }
  }
</script>

<svelte:head>
  <title>Identifier Patterns - LogTide</title>
</svelte:head>

<div class="container mx-auto space-y-6 p-6">
  <div class="flex items-center gap-4">
    <Button variant="ghost" size="icon" onclick={() => goto('/dashboard/settings')}>
      <ArrowLeft class="w-4 h-4" />
    </Button>
    <div>
      <h1 class="text-3xl font-bold tracking-tight">Identifier Patterns</h1>
      <div class="flex items-center gap-2 mt-1">
        <Fingerprint class="w-4 h-4 text-muted-foreground" />
        <p class="text-muted-foreground">
          Configure patterns for extracting identifiers from logs
        </p>
      </div>
    </div>
  </div>

  <!-- Custom Patterns -->
  <Card>
    <CardHeader>
      <div class="flex items-center justify-between">
        <div>
          <CardTitle>Custom Patterns</CardTitle>
          <CardDescription>
            Organization-specific patterns for your unique identifier formats
          </CardDescription>
        </div>
        <div class="flex gap-2">
          <Button variant="outline" onclick={() => openTestDialog()} class="gap-2">
            <FlaskConical class="w-4 h-4" />
            Test Pattern
          </Button>
          <Button onclick={openCreateDialog} class="gap-2">
            <Plus class="w-4 h-4" />
            Add Pattern
          </Button>
        </div>
      </div>
    </CardHeader>
    <CardContent>
      {#if loading}
        <div class="flex items-center justify-center py-8">
          <Spinner size="md" />
          <span class="ml-2 text-sm text-muted-foreground">Loading patterns...</span>
        </div>
      {:else if customPatterns.length === 0}
        <div class="text-center py-8 border-2 border-dashed rounded-lg">
          <Fingerprint class="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p class="text-sm text-muted-foreground mb-4">
            No custom patterns yet. Create one to extract your application-specific identifiers.
          </p>
          <Button onclick={openCreateDialog} variant="outline" class="gap-2">
            <Plus class="w-4 h-4" />
            Create Your First Pattern
          </Button>
        </div>
      {:else}
        <div class="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Pattern</TableHead>
                <TableHead>Field Names</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead class="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each customPatterns as pattern}
                <TableRow>
                  <TableCell>
                    <div>
                      <div class="font-medium">{pattern.displayName}</div>
                      <div class="text-xs text-muted-foreground font-mono">{pattern.name}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code class="text-xs bg-muted px-2 py-1 rounded max-w-[200px] truncate block">
                      {pattern.pattern}
                    </code>
                  </TableCell>
                  <TableCell>
                    <div class="flex flex-wrap gap-1">
                      {#each pattern.fieldNames.slice(0, 3) as field}
                        <Badge variant="outline" class="text-xs">{field}</Badge>
                      {/each}
                      {#if pattern.fieldNames.length > 3}
                        <Badge variant="outline" class="text-xs">+{pattern.fieldNames.length - 3}</Badge>
                      {/if}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{pattern.priority}</Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={pattern.enabled}
                      onCheckedChange={() => handleToggleEnabled(pattern)}
                    />
                  </TableCell>
                  <TableCell>
                    <div class="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8"
                        onclick={() => openTestDialog(pattern.pattern)}
                        title="Test pattern"
                      >
                        <FlaskConical class="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8"
                        onclick={() => openEditDialog(pattern)}
                        title="Edit pattern"
                      >
                        <Pencil class="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8 text-destructive hover:text-destructive"
                        onclick={() => openDeleteDialog(pattern)}
                        title="Delete pattern"
                      >
                        <Trash2 class="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              {/each}
            </TableBody>
          </Table>
        </div>
      {/if}
    </CardContent>
  </Card>

  <!-- Default Patterns -->
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        <Lock class="w-4 h-4" />
        Built-in Patterns
      </CardTitle>
      <CardDescription>
        These patterns are always active and cannot be modified. They cover common identifier formats.
      </CardDescription>
    </CardHeader>
    <CardContent>
      {#if loading}
        <div class="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      {:else}
        <div class="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Pattern</TableHead>
                <TableHead>Field Names</TableHead>
                <TableHead>Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each defaultPatterns as pattern}
                <TableRow class="bg-muted/30">
                  <TableCell>
                    <div class="font-medium">{pattern.displayName}</div>
                  </TableCell>
                  <TableCell>
                    <code class="text-xs bg-muted px-2 py-1 rounded max-w-[200px] truncate block">
                      {pattern.pattern}
                    </code>
                  </TableCell>
                  <TableCell>
                    <div class="flex flex-wrap gap-1">
                      {#each pattern.fieldNames.slice(0, 3) as field}
                        <Badge variant="outline" class="text-xs">{field}</Badge>
                      {/each}
                      {#if pattern.fieldNames.length > 3}
                        <Badge variant="outline" class="text-xs">+{pattern.fieldNames.length - 3}</Badge>
                      {/if}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{pattern.priority}</Badge>
                  </TableCell>
                </TableRow>
              {/each}
            </TableBody>
          </Table>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>

<!-- Create/Edit Pattern Dialog -->
<Dialog bind:open={editDialogOpen}>
  <DialogContent class="max-w-lg">
    <DialogHeader>
      <DialogTitle>{isCreating ? 'Create Pattern' : 'Edit Pattern'}</DialogTitle>
      <DialogDescription>
        {isCreating
          ? 'Define a new pattern to extract identifiers from your logs.'
          : 'Update the pattern configuration.'}
      </DialogDescription>
    </DialogHeader>

    <form onsubmit={(e) => { e.preventDefault(); handleSave(); }} class="space-y-4">
      {#if isCreating}
        <div class="space-y-2">
          <Label for="pattern-name">Name *</Label>
          <Input
            id="pattern-name"
            type="text"
            placeholder="customer_id"
            bind:value={formName}
            disabled={saving}
            required
          />
          <p class="text-xs text-muted-foreground">
            Lowercase letters, numbers, and underscores only. Must start with a letter.
          </p>
        </div>
      {/if}

      <div class="space-y-2">
        <Label for="pattern-display-name">Display Name *</Label>
        <Input
          id="pattern-display-name"
          type="text"
          placeholder="Customer ID"
          bind:value={formDisplayName}
          disabled={saving}
          required
        />
      </div>

      <div class="space-y-2">
        <Label for="pattern-description">Description</Label>
        <Textarea
          id="pattern-description"
          placeholder="Matches customer IDs in format CUS-XXXXXXXX"
          bind:value={formDescription}
          disabled={saving}
          rows={2}
        />
      </div>

      <div class="space-y-2">
        <Label for="pattern-regex">Regex Pattern *</Label>
        <Input
          id="pattern-regex"
          type="text"
          placeholder="CUS-[A-Z0-9]{8}"
          bind:value={formPattern}
          disabled={saving}
          required
          class="font-mono text-sm"
        />
        <p class="text-xs text-muted-foreground">
          Use a capture group to extract the identifier value. Example: <code>(CUS-[A-Z0-9]{'{8}'})</code>
        </p>
      </div>

      <div class="space-y-2">
        <Label for="pattern-fields">Field Names</Label>
        <Input
          id="pattern-fields"
          type="text"
          placeholder="customer_id, customerId, cust_id"
          bind:value={formFieldNames}
          disabled={saving}
        />
        <p class="text-xs text-muted-foreground">
          Comma-separated list of metadata field names that should match this pattern type.
        </p>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="space-y-2">
          <Label for="pattern-priority">Priority</Label>
          <Input
            id="pattern-priority"
            type="number"
            min={1}
            max={1000}
            bind:value={formPriority}
            disabled={saving}
          />
          <p class="text-xs text-muted-foreground">Lower = higher priority (1-1000)</p>
        </div>

        <div class="space-y-2">
          <Label>Enabled</Label>
          <div class="flex items-center gap-2 pt-2">
            <Switch bind:checked={formEnabled} disabled={saving} />
            <span class="text-sm">{formEnabled ? 'Active' : 'Disabled'}</span>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onclick={() => editDialogOpen = false} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : isCreating ? 'Create Pattern' : 'Save Changes'}
        </Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>

<!-- Delete Confirmation Dialog -->
<AlertDialog bind:open={deleteDialogOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete Pattern?</AlertDialogTitle>
      <AlertDialogDescription>
        Are you sure you want to delete the pattern <strong>{editingPattern?.displayName}</strong>?
        This action cannot be undone. Existing extracted identifiers will not be affected.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onclick={() => { deleteDialogOpen = false; editingPattern = null; }}>
        Cancel
      </AlertDialogCancel>
      <AlertDialogAction
        onclick={handleDelete}
        class="bg-destructive hover:bg-destructive/90"
        disabled={deleting}
      >
        {deleting ? 'Deleting...' : 'Delete Pattern'}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

<!-- Test Pattern Dialog -->
<Dialog bind:open={testDialogOpen}>
  <DialogContent class="max-w-2xl">
    <DialogHeader>
      <DialogTitle>Test Pattern</DialogTitle>
      <DialogDescription>
        Enter a regex pattern and sample text to see what matches.
      </DialogDescription>
    </DialogHeader>

    <div class="space-y-4">
      <div class="space-y-2">
        <Label for="test-pattern">Regex Pattern</Label>
        <Input
          id="test-pattern"
          type="text"
          placeholder="CUS-[A-Z0-9]{8}"
          bind:value={testPattern}
          disabled={testing}
          class="font-mono text-sm"
        />
      </div>

      <div class="space-y-2">
        <Label for="test-text">Sample Text</Label>
        <Textarea
          id="test-text"
          placeholder="Enter log message or metadata text to test against..."
          bind:value={testText}
          disabled={testing}
          rows={4}
          class="font-mono text-sm"
        />
      </div>

      <Button onclick={handleTest} disabled={testing || !testPattern || !testText} class="w-full gap-2">
        <FlaskConical class="w-4 h-4" />
        {testing ? 'Testing...' : 'Run Test'}
      </Button>

      {#if testResults.length > 0}
        <div class="space-y-2">
          <Label>Matches ({testResults.length})</Label>
          <div class="bg-muted rounded-md p-3 space-y-2 max-h-[200px] overflow-y-auto">
            {#each testResults as match, i}
              <div class="flex items-center gap-2">
                <Check class="w-4 h-4 text-green-500 flex-shrink-0" />
                <code class="text-sm bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded">{match}</code>
              </div>
            {/each}
          </div>
        </div>
      {:else if testText && !testing}
        <div class="flex items-center gap-2 text-muted-foreground">
          <X class="w-4 h-4" />
          <span class="text-sm">No matches found</span>
        </div>
      {/if}
    </div>

    <DialogFooter>
      <Button variant="outline" onclick={() => testDialogOpen = false}>
        Close
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
