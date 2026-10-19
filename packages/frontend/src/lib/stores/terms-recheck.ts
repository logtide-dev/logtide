import { writable } from 'svelte/store';

/**
 * Bumped whenever an API call is refused with `terms_not_accepted` (e.g. the
 * terms version changed while the page was open). TermsAcceptanceModal listens
 * and re-runs its pending check, so the modal appears without a reload.
 */
export const termsRecheck = writable(0);

export function requestTermsRecheck(): void {
  termsRecheck.update((n) => n + 1);
}
