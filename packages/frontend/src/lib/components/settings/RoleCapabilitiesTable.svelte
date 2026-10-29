<script lang="ts">
  import type { OrgRole } from '@logtide/shared';
  import Check from '@lucide/svelte/icons/check';
  import Minus from '@lucide/svelte/icons/minus';
  import { ROLE_CAPABILITIES, roleLabel } from './roles';

  const COLUMNS: OrgRole[] = ['owner', 'admin', 'member'];
</script>

<div class="overflow-x-auto">
  <table class="w-full text-sm">
    <caption class="sr-only">What each organization role can do</caption>
    <thead>
      <tr class="border-b border-border text-left text-muted-foreground">
        <th scope="col" class="py-2 pr-4 font-medium">Capability</th>
        {#each COLUMNS as role (role)}
          <th scope="col" class="px-3 py-2 text-center font-medium">{roleLabel(role)}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each ROLE_CAPABILITIES as cap (cap.id)}
        <tr class="border-b border-border last:border-0" data-testid="role-capability-row">
          <th scope="row" class="py-2 pr-4 text-left font-normal">{cap.label}</th>
          {#each COLUMNS as role (role)}
            <td class="px-3 py-2 text-center">
              {#if cap.roles.includes(role)}
                <span role="img" aria-label="Allowed" class="inline-flex text-success-text">
                  <Check class="w-4 h-4" aria-hidden="true" />
                </span>
              {:else}
                <span role="img" aria-label="Not allowed" class="inline-flex text-muted-foreground">
                  <Minus class="w-4 h-4" aria-hidden="true" />
                </span>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
