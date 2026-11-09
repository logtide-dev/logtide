<script lang="ts">
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import PasswordStrengthMeter from './PasswordStrengthMeter.svelte';

  interface Props {
    id: string;
    label?: string;
    value?: string;
    /** True only while the password passes the strength policy. */
    ok?: boolean;
    /** The account the password is for: it must not be built from its email or name. */
    user?: { email?: string | null; name?: string | null };
    disabled?: boolean;
    autocomplete?: 'new-password';
    onCheck?: (ok: boolean) => void;
  }

  let {
    id,
    label = 'Password',
    value = $bindable(''),
    ok = $bindable(false),
    user = {},
    disabled = false,
    autocomplete = 'new-password',
    onCheck,
  }: Props = $props();

  let showPassword = $state(false);
</script>

<div class="space-y-2">
  <Label for={id}>{label}</Label>
  <div class="relative">
    <Input
      {id}
      type={(showPassword ? 'text' : 'password') as 'text'}
      {autocomplete}
      bind:value
      {disabled}
      aria-describedby={`${id}-strength`}
      class="pr-10"
    />
    <button
      type="button"
      class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={showPassword ? 'Hide password' : 'Show password'}
      aria-pressed={showPassword}
      onclick={() => (showPassword = !showPassword)}
    >
      {#if showPassword}
        <EyeOff class="size-4" aria-hidden="true" />
      {:else}
        <Eye class="size-4" aria-hidden="true" />
      {/if}
    </button>
  </div>
  <PasswordStrengthMeter id={`${id}-strength`} {value} bind:ok {user} {onCheck} />
</div>
