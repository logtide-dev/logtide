<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { toastStore } from '$lib/stores/toast';
  import {
    piiMaskingAPI,
    type PiiMaskingRule,
    type PiiAction,
    type PiiPatternType,
  } from '$lib/api/pii-masking';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Switch } from '$lib/components/ui/switch';
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '$lib/components/ui/select';
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
  import ShieldAlert from '@lucide/svelte/icons/shield-alert';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import FlaskConical from '@lucide/svelte/icons/flask-conical';
  import Lock from '@lucide/svelte/icons/lock';

  let token: string | null = null;

  let loading = $state(true);
  let rules = $state<PiiMaskingRule[]>([]);

  // Computed rule groups
  let contentRules = $derived(rules.filter((r) => r.patternType === 'builtin' || (r.patternType === 'custom' && r.regexPattern)));
  let fieldRules = $derived(rules.filter((r) => r.patternType === 'field_name'));
  let customRules = $derived(rules.filter((r) => r.patternType === 'custom'));

  // Dialog states
  let editDialogOpen = $state(false);
  let deleteDialogOpen = $state(false);
  let testDialogOpen = $state(false);

  // Form state
  let editingRule = $state<PiiMaskingRule | null>(null);
  let isCreating = $state(false);
  let saving = $state(false);
  let deleting = $state(false);

  // Form fields
  let formName = $state('');
  let formDisplayName = $state('');
  let formDescription = $state('');
  let formPatternType = $state<PiiPatternType>('custom');
  let formRegexPattern = $state('');
  let formFieldNames = $state('');
  let formAction = $state<PiiAction>('redact');
  let formPriority = $state(50);
  let formEnabled = $state(true);

  // Track which field rules have expanded field names
  let expandedFieldRules = $state<Set<string>>(new Set());

  function toggleFieldNames(ruleId: string) {
    const next = new Set(expandedFieldRules);
    if (next.has(ruleId)) {
      next.delete(ruleId);
    } else {
      next.add(ruleId);
    }
    expandedFieldRules = next;
  }

  // Test panel state
  let testMessage = $state('User john.doe@example.com logged in from 192.168.1.100 with card 4111-1111-1111-1234');
  let testMetadata = $state('{\n  "password": "secret123",\n  "email": "jane@test.com",\n  "userId": "usr_abc"\n}');
  let testResultMessage = $state('');
  let testResultMetadata = $state('');
  let testMaskedFields = $state<string[]>([]);
  let testing = $state(false);

  const unsubAuthStore = authStore.subscribe((state) => {
    token = state.token;
  });

  onDestroy(() => {
    unsubAuthStore();
  });

  onMount(async () => {
    if (!token) {
      goto('/login');
      return;
    }
    await loadRules();
  });

  async function loadRules() {
    loading = true;
    try {
      rules = await piiMaskingAPI.listRules();
    } catch (e) {
      console.error('Failed to load PII masking rules:', e);
      toastStore.error('Failed to load PII masking rules');
    } finally {
      loading = false;
    }
  }

  function openCreateDialog() {
    isCreating = true;
    editingRule = null;
    formName = '';
    formDisplayName = '';
    formDescription = '';
    formPatternType = 'custom';
    formRegexPattern = '';
    formFieldNames = '';
    formAction = 'redact';
    formPriority = 50;
    formEnabled = true;
    editDialogOpen = true;
  }

  function openEditDialog(rule: PiiMaskingRule) {
    isCreating = false;
    editingRule = rule;
    formName = rule.name;
    formDisplayName = rule.displayName;
    formDescription = rule.description || '';
    formPatternType = rule.patternType;
    formRegexPattern = rule.regexPattern || '';
    formFieldNames = rule.fieldNames.join(', ');
    formAction = rule.action;
    formPriority = rule.priority;
    formEnabled = rule.enabled;
    editDialogOpen = true;
  }

  function openDeleteDialog(rule: PiiMaskingRule) {
    editingRule = rule;
    deleteDialogOpen = true;
  }

  async function handleSave() {
    saving = true;
    try {
      const fieldNames = formFieldNames
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);

      if (isCreating) {
        if (!formName || !formDisplayName) {
          toastStore.error('Please fill in name and display name');
          saving = false;
          return;
        }

        if (formPatternType === 'custom' && !formRegexPattern.trim()) {
          toastStore.error('Please provide a regex pattern for a custom rule');
          saving = false;
          return;
        }

        if (formPatternType === 'field_name' && fieldNames.length === 0) {
          toastStore.error('Please provide at least one field name');
          saving = false;
          return;
        }

        await piiMaskingAPI.createRule({
          name: formName,
          displayName: formDisplayName,
          description: formDescription || undefined,
          patternType: formPatternType,
          regexPattern: formRegexPattern || undefined,
          fieldNames: fieldNames.length > 0 ? fieldNames : undefined,
          action: formAction,
          priority: formPriority,
          enabled: formEnabled,
        });
        toastStore.success('Rule created');
      } else if (editingRule) {
        // For built-in rules without a real ID, create a DB row to override
        if (editingRule.id.startsWith('builtin:')) {
          await piiMaskingAPI.createRule({
            name: editingRule.name,
            displayName: formDisplayName,
            description: formDescription || undefined,
            patternType: editingRule.patternType,
            regexPattern: formRegexPattern || undefined,
            fieldNames: fieldNames.length > 0 ? fieldNames : undefined,
            action: formAction,
            priority: formPriority,
            enabled: formEnabled,
          });
        } else {
          await piiMaskingAPI.updateRule(editingRule.id, {
            displayName: formDisplayName,
            description: formDescription || undefined,
            regexPattern: formRegexPattern || undefined,
            fieldNames: fieldNames.length > 0 ? fieldNames : undefined,
            action: formAction,
            priority: formPriority,
            enabled: formEnabled,
          });
        }
        toastStore.success('Rule updated');
      }

      editDialogOpen = false;
      await loadRules();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save rule';
      toastStore.error(msg);
    } finally {
      saving = false;
    }
  }

  async function handleDelete() {
    if (!editingRule || editingRule.id.startsWith('builtin:')) return;

    deleting = true;
    try {
      await piiMaskingAPI.deleteRule(editingRule.id);
      toastStore.success('Rule deleted');
      deleteDialogOpen = false;
      editingRule = null;
      await loadRules();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to delete rule';
      toastStore.error(msg);
    } finally {
      deleting = false;
    }
  }

  async function handleToggleEnabled(rule: PiiMaskingRule) {
    try {
      if (rule.id.startsWith('builtin:')) {
        await piiMaskingAPI.createRule({
          name: rule.name,
          displayName: rule.displayName,
          description: rule.description || undefined,
          patternType: rule.patternType,
          regexPattern: rule.regexPattern || undefined,
          fieldNames: rule.fieldNames.length > 0 ? rule.fieldNames : undefined,
          action: rule.action,
          enabled: !rule.enabled,
        });
        // Builtin override changes the ID, need full reload
        await loadRules();
      } else {
        await piiMaskingAPI.updateRule(rule.id, { enabled: !rule.enabled });
        // Update locally to avoid full page refresh
        rules = rules.map((r) => r.id === rule.id ? { ...r, enabled: !r.enabled } : r);
      }
      toastStore.success(!rule.enabled ? `${rule.displayName} enabled` : `${rule.displayName} disabled`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update rule';
      toastStore.error(msg);
    }
  }

  async function handleActionChange(rule: PiiMaskingRule, newAction: PiiAction) {
    try {
      if (rule.id.startsWith('builtin:')) {
        await piiMaskingAPI.createRule({
          name: rule.name,
          displayName: rule.displayName,
          description: rule.description || undefined,
          patternType: rule.patternType,
          regexPattern: rule.regexPattern || undefined,
          fieldNames: rule.fieldNames.length > 0 ? rule.fieldNames : undefined,
          action: newAction,
          enabled: rule.enabled,
        });
        // Builtin override changes the ID, need full reload
        await loadRules();
      } else {
        await piiMaskingAPI.updateRule(rule.id, { action: newAction });
        // Update locally to avoid full page refresh
        rules = rules.map((r) => r.id === rule.id ? { ...r, action: newAction } : r);
      }
      toastStore.success(`${rule.displayName} set to ${newAction}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update action';
      toastStore.error(msg);
    }
  }

  async function handleTestMasking() {
    testing = true;
    testResultMessage = '';
    testResultMetadata = '';
    testMaskedFields = [];

    try {
      let metadata: Record<string, unknown> | undefined;
      if (testMetadata.trim()) {
        try {
          metadata = JSON.parse(testMetadata);
        } catch {
          toastStore.error('Invalid JSON in metadata field');
          testing = false;
          return;
        }
      }

      const result = await piiMaskingAPI.testMasking(
        testMessage || undefined,
        metadata
      );

      testResultMessage = result.message || '';
      testResultMetadata = result.metadata ? JSON.stringify(result.metadata, null, 2) : '';
      testMaskedFields = result.maskedFields;

      if (result.maskedFields.length === 0) {
        toastStore.info('No PII detected. Make sure you have enabled rules.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Test failed';
      toastStore.error(msg);
    } finally {
      testing = false;
    }
  }

  const actionLabels: Record<PiiAction, string> = {
    mask: 'Mask',
    redact: 'Redact',
    hash: 'Hash',
  };

  const actionDialogLabels: Record<PiiAction, string> = {
    mask: 'Mask (partial)',
    redact: 'Redact (full)',
    hash: 'Hash (SHA-256)',
  };

  const patternTypeLabels: Record<PiiPatternType, string> = {
    custom: 'Custom Regex',
    field_name: 'Field Names',
    builtin: 'Built-in',
  };

  function getActionBadgeVariant(action: PiiAction): 'default' | 'secondary' | 'outline' {
    if (action === 'redact') return 'default';
    if (action === 'mask') return 'secondary';
    return 'outline';
  }
</script>

<svelte:head>
  <title>PII Masking - LogTide</title>
</svelte:head>

<div class="space-y-6">
  <!-- Content Patterns -->
  <Card>
    <CardHeader>
      <div class="flex items-center justify-between">
        <div>
          <CardTitle class="flex items-center gap-2">
            Content Patterns
          </CardTitle>
          <CardDescription>
            Regex-based detection of PII in log messages and metadata values
          </CardDescription>
        </div>
        <Button onclick={openCreateDialog} class="gap-2">
          <Plus class="w-4 h-4" />
          Add Rule
        </Button>
      </div>
    </CardHeader>
    <CardContent>
      {#if loading}
        <div class="flex items-center justify-center py-8">
          <Spinner size="md" />
          <span class="ml-2 text-sm text-muted-foreground">Loading rules...</span>
        </div>
      {:else}
        <div class="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead>
                <TableHead>Pattern</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead class="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each contentRules as rule}
                <TableRow class={rule.isBuiltIn && rule.id.startsWith('builtin:') ? 'bg-muted/30' : ''}>
                  <TableCell>
                    <div>
                      <div class="font-medium flex items-center gap-2">
                        {rule.displayName}
                        {#if rule.isBuiltIn && rule.id.startsWith('builtin:')}
                          <Lock class="w-3 h-3 text-muted-foreground" />
                        {/if}
                        {#if rule.patternType === 'custom'}
                          <Badge variant="outline" class="text-xs">Custom</Badge>
                        {/if}
                      </div>
                      {#if rule.description}
                        <div class="text-xs text-muted-foreground mt-0.5">{rule.description}</div>
                      {/if}
                    </div>
                  </TableCell>
                  <TableCell>
                    {#if rule.regexPattern}
                      <code class="text-xs bg-muted px-2 py-1 rounded max-w-[200px] truncate block">
                        {rule.regexPattern}
                      </code>
                    {:else}
                      <span class="text-xs text-muted-foreground">-</span>
                    {/if}
                  </TableCell>
                  <TableCell>
                    <Select
                      type="single"
                      value={rule.action}
                      onValueChange={(v) => { if (v) handleActionChange(rule, v as PiiAction); }}
                    >
                      <SelectTrigger class="w-[100px] h-8">
                        <SelectValue>{actionLabels[rule.action]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mask">Mask</SelectItem>
                        <SelectItem value="redact">Redact</SelectItem>
                        <SelectItem value="hash">Hash</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={() => handleToggleEnabled(rule)}
                    />
                  </TableCell>
                  <TableCell>
                    <div class="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8"
                        onclick={() => openEditDialog(rule)}
                        title="Edit rule"
                      >
                        <Pencil class="w-4 h-4" />
                      </Button>
                      {#if !rule.id.startsWith('builtin:')}
                        <Button
                          variant="ghost"
                          size="icon"
                          class="h-8 w-8 text-destructive hover:text-destructive"
                          onclick={() => openDeleteDialog(rule)}
                          title="Delete rule"
                        >
                          <Trash2 class="w-4 h-4" />
                        </Button>
                      {/if}
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

  <!-- Sensitive Field Names (Phase 2) -->
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        <Lock class="w-4 h-4" />
        Sensitive Field Names
      </CardTitle>
      <CardDescription>
        Automatically mask values of metadata fields with sensitive names (password, token, secret, etc.)
      </CardDescription>
    </CardHeader>
    <CardContent>
      {#if loading}
        <div class="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      {:else if fieldRules.length === 0}
        <p class="text-sm text-muted-foreground py-4">No field name rules configured.</p>
      {:else}
        {#each fieldRules as rule}
          <div class="flex items-center justify-between p-4 rounded-lg border">
            <div class="flex-1">
              <div class="font-medium flex items-center gap-2">
                {rule.displayName}
                {#if rule.id.startsWith('builtin:')}
                  <Lock class="w-3 h-3 text-muted-foreground" />
                {/if}
              </div>
              {#if rule.description}
                <p class="text-xs text-muted-foreground mt-1">{rule.description}</p>
              {/if}
              <div class="flex flex-wrap gap-1 mt-2">
                {#each expandedFieldRules.has(rule.id) ? rule.fieldNames : rule.fieldNames.slice(0, 10) as field}
                  <Badge variant="outline" class="text-xs font-mono">{field}</Badge>
                {/each}
                {#if rule.fieldNames.length > 10}
                  <button
                    type="button"
                    class="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    onclick={() => toggleFieldNames(rule.id)}
                  >
                    {expandedFieldRules.has(rule.id) ? 'show less' : `+${rule.fieldNames.length - 10} more`}
                  </button>
                {/if}
              </div>
            </div>
            <div class="flex items-center gap-4 ml-4">
              <Select
                type="single"
                value={rule.action}
                onValueChange={(v) => { if (v) handleActionChange(rule, v as PiiAction); }}
              >
                <SelectTrigger class="w-[100px] h-8">
                  <SelectValue>{actionLabels[rule.action]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mask">Mask</SelectItem>
                  <SelectItem value="redact">Redact</SelectItem>
                  <SelectItem value="hash">Hash</SelectItem>
                </SelectContent>
              </Select>
              <Switch
                checked={rule.enabled}
                onCheckedChange={() => handleToggleEnabled(rule)}
              />
            </div>
          </div>
        {/each}
      {/if}
    </CardContent>
  </Card>

  <!-- Test Panel -->
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        <FlaskConical class="w-4 h-4" />
        Test Masking
      </CardTitle>
      <CardDescription>
        Preview how your enabled rules mask sample data
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div class="space-y-4">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="space-y-4">
            <div class="space-y-2">
              <Label for="test-message">Sample Message</Label>
              <Textarea
                id="test-message"
                bind:value={testMessage}
                disabled={testing}
                rows={3}
                class="font-mono text-sm"
                placeholder="Enter a log message with PII..."
              />
            </div>
            <div class="space-y-2">
              <Label for="test-metadata">Sample Metadata (JSON)</Label>
              <Textarea
                id="test-metadata"
                bind:value={testMetadata}
                disabled={testing}
                rows={5}
                class="font-mono text-sm"
                placeholder={'{"password": "secret", "email": "user@example.com"}'}
              />
            </div>
            <Button onclick={handleTestMasking} disabled={testing} class="w-full gap-2">
              <FlaskConical class="w-4 h-4" />
              {testing ? 'Testing...' : 'Test Masking'}
            </Button>
          </div>

          <div class="space-y-4">
            {#if testResultMessage || testResultMetadata}
              <div class="space-y-2">
                <Label>Masked Message</Label>
                <div class="bg-muted rounded-md p-3 font-mono text-sm whitespace-pre-wrap min-h-[60px]">
                  {testResultMessage || '(empty)'}
                </div>
              </div>
              <div class="space-y-2">
                <Label>Masked Metadata</Label>
                <div class="bg-muted rounded-md p-3 font-mono text-sm whitespace-pre-wrap min-h-[80px]">
                  {testResultMetadata || '(empty)'}
                </div>
              </div>
              {#if testMaskedFields.length > 0}
                <div class="space-y-2">
                  <Label>Masked Fields ({testMaskedFields.length})</Label>
                  <div class="flex flex-wrap gap-1">
                    {#each testMaskedFields as field}
                      <Badge variant="secondary" class="text-xs font-mono">{field}</Badge>
                    {/each}
                  </div>
                </div>
              {/if}
            {:else}
              <div class="flex items-center justify-center h-full text-muted-foreground text-sm">
                Click "Test Masking" to preview results
              </div>
            {/if}
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</div>

<!-- Create/Edit Rule Dialog -->
<Dialog bind:open={editDialogOpen}>
  <DialogContent class="max-w-lg">
    <DialogHeader>
      <DialogTitle>{isCreating ? 'Create Custom Rule' : 'Edit Rule'}</DialogTitle>
      <DialogDescription>
        {isCreating
          ? 'Define a custom PII masking rule with a regex pattern or field names.'
          : 'Update the rule configuration.'}
      </DialogDescription>
    </DialogHeader>

    <form onsubmit={(e) => { e.preventDefault(); handleSave(); }} class="space-y-4">
      {#if isCreating}
        <div class="space-y-2">
          <Label for="rule-name">Name *</Label>
          <Input
            id="rule-name"
            type="text"
            placeholder="custom_id_pattern"
            bind:value={formName}
            disabled={saving}
            required
          />
          <p class="text-xs text-muted-foreground">
            Lowercase letters, numbers, and underscores only.
          </p>
        </div>
      {/if}

      <div class="space-y-2">
        <Label for="rule-display-name">Display Name *</Label>
        <Input
          id="rule-display-name"
          type="text"
          placeholder="Custom ID Pattern"
          bind:value={formDisplayName}
          disabled={saving}
          required
        />
      </div>

      <div class="space-y-2">
        <Label for="rule-description">Description</Label>
        <Textarea
          id="rule-description"
          placeholder="Describe what this rule detects..."
          bind:value={formDescription}
          disabled={saving}
          rows={2}
        />
      </div>

      {#if isCreating}
        <div class="space-y-2">
          <Label>Rule Type</Label>
          <Select
            type="single"
            value={formPatternType}
            onValueChange={(v) => { if (v) formPatternType = v as PiiPatternType; }}
          >
            <SelectTrigger>
              <SelectValue>{patternTypeLabels[formPatternType]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="custom">Custom Regex</SelectItem>
              <SelectItem value="field_name">Field Names</SelectItem>
            </SelectContent>
          </Select>
        </div>
      {/if}

      {#if formPatternType === 'custom' || formPatternType === 'builtin'}
        <div class="space-y-2">
          <Label for="rule-regex">Regex Pattern</Label>
          <Input
            id="rule-regex"
            type="text"
            placeholder="\b[A-Z]{2}-\d{6}\b"
            bind:value={formRegexPattern}
            disabled={saving}
            class="font-mono text-sm"
          />
        </div>
      {/if}

      {#if formPatternType === 'field_name'}
        <div class="space-y-2">
          <Label for="rule-fields">Field Names</Label>
          <Input
            id="rule-fields"
            type="text"
            placeholder="custom_secret, my_token, private_data"
            bind:value={formFieldNames}
            disabled={saving}
          />
          <p class="text-xs text-muted-foreground">
            Comma-separated list of metadata field names to mask.
          </p>
        </div>
      {/if}

      <div class="grid grid-cols-2 gap-4">
        <div class="space-y-2">
          <Label>Masking Action</Label>
          <Select
            type="single"
            value={formAction}
            onValueChange={(v) => { if (v) formAction = v as PiiAction; }}
          >
            <SelectTrigger>
              <SelectValue>{actionDialogLabels[formAction]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mask">Mask (partial)</SelectItem>
              <SelectItem value="redact">Redact (full)</SelectItem>
              <SelectItem value="hash">Hash (SHA-256)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="space-y-2">
          <Label>Priority</Label>
          <Input
            type="number"
            min={1}
            max={1000}
            bind:value={formPriority}
            disabled={saving}
          />
        </div>
      </div>

      <div class="space-y-2">
        <Label>Enabled</Label>
        <div class="flex items-center gap-2">
          <Switch bind:checked={formEnabled} disabled={saving} />
          <span class="text-sm">{formEnabled ? 'Active' : 'Disabled'}</span>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onclick={() => editDialogOpen = false} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : isCreating ? 'Create Rule' : 'Save Changes'}
        </Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>

<!-- Delete Confirmation -->
<AlertDialog bind:open={deleteDialogOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete Rule?</AlertDialogTitle>
      <AlertDialogDescription>
        Are you sure you want to delete <strong>{editingRule?.displayName}</strong>?
        This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onclick={() => { deleteDialogOpen = false; editingRule = null; }}>
        Cancel
      </AlertDialogCancel>
      <AlertDialogAction
        onclick={handleDelete}
        class="bg-destructive hover:bg-destructive/90"
        disabled={deleting}
      >
        {deleting ? 'Deleting...' : 'Delete Rule'}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
