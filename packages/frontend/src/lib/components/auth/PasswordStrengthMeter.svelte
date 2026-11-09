<script lang="ts">
  import type { PasswordCheck } from '@logtide/shared/password';

  interface Props {
    /** id of the element, referenced by the input's aria-describedby. */
    id: string;
    value: string;
    /** True only while the password passes the strength policy. */
    ok?: boolean;
    /** The account the password is for: it must not be built from its email or name. */
    user?: { email?: string | null; name?: string | null };
    onCheck?: (ok: boolean) => void;
  }

  let { id, value, ok = $bindable(false), user = {}, onCheck }: Props = $props();

  type Policy = typeof import('@logtide/shared/password');

  // The policy carries large dictionaries: load it on first use so it never
  // weighs on pages without a password field.
  let policy = $state<Policy | null>(null);
  let loading: Promise<void> | null = null;

  function loadPolicy() {
    loading ??= import('@logtide/shared/password').then((m) => {
      policy = m;
    });
    return loading;
  }

  // zxcvbn costs up to ~200 ms on a long password: judge once typing pauses,
  // not on every keystroke.
  const DEBOUNCE_MS = 150;
  let judged = $state('');

  $effect(() => {
    const next = value;
    const timer = setTimeout(() => (judged = next), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  const check = $derived<PasswordCheck | null>(
    policy && judged ? policy.checkPasswordStrength(judged, policy.passwordUserInputs(user)) : null
  );

  const strength = $derived.by(() => {
    if (!check) return null;
    if (check.ok) return { label: 'Strong', segments: 4, bar: 'bg-success', text: 'text-success-text' };
    if (check.score >= 2) return { label: 'Fair', segments: 2, bar: 'bg-warning', text: 'text-warning-text' };
    return { label: 'Weak', segments: 1, bar: 'bg-destructive', text: 'text-destructive-text' };
  });

  $effect(() => {
    // Never ok for a value that has not been judged yet.
    const next = (check?.ok ?? false) && judged === value;
    if (next !== ok) ok = next;
    onCheck?.(next);
  });

  $effect(() => {
    if (value) void loadPolicy();
  });
</script>

<div {id} class="space-y-1.5">
  <div class="flex gap-1" aria-hidden="true">
    {#each [1, 2, 3, 4] as segment (segment)}
      <div class="h-1 flex-1 rounded-full {strength && segment <= strength.segments ? strength.bar : 'bg-muted'}"></div>
    {/each}
  </div>
  {#if strength && check}
    <p aria-live="polite" class="flex gap-2 text-xs">
      <span class="font-medium {strength.text}">{strength.label}</span>
      {#if check.message}<span class="text-muted-foreground">{check.message}</span>{/if}
    </p>
  {:else}
    <p aria-live="polite" class="text-xs text-muted-foreground">Use at least 12 characters. A few unrelated words work well.</p>
  {/if}
</div>
