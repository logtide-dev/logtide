import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { guessCountry, isEuCountry } from '$lib/utils/eu-vat';

// Per-viewer choice for how plan prices are shown (with or without VAT). Mirrors
// the pricing page on logtide.dev; it describes the viewer, so it stays in
// localStorage. Display only: checkout always taxes from the billing address.
const STORAGE_KEY = 'logtide_billing_vat';

export type VatAudience = 'personal' | 'business';

export interface BillingVatView {
  audience: VatAudience;
  /** EU country code, or 'OUT' for outside the EU. */
  country: string;
}

function browserGuess(): string {
  try {
    let timeZone: string | undefined;
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      // no Intl time zone: language only
    }
    return guessCountry(timeZone, typeof navigator === 'undefined' ? undefined : navigator.language);
  } catch {
    return 'OUT';
  }
}

function defaults(): BillingVatView {
  const country = browserGuess();
  return { audience: country === 'OUT' ? 'business' : 'personal', country };
}

function load(): BillingVatView {
  if (browser) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (
        saved &&
        (saved.audience === 'personal' || saved.audience === 'business') &&
        typeof saved.country === 'string' &&
        (saved.country === 'OUT' || isEuCountry(saved.country))
      ) {
        return { audience: saved.audience, country: saved.country };
      }
    } catch {
      // unreadable or blocked: fall through to the default
    }
  }
  return defaults();
}

function createStore() {
  // In-memory source of truth so get() survives blocked localStorage.
  let current = load();
  const { subscribe, set } = writable<BillingVatView>(current);

  function update(next: BillingVatView) {
    current = next;
    if (browser) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage may be unavailable
      }
    }
    set(next);
  }

  return {
    subscribe,
    get: (): BillingVatView => current,
    setAudience(audience: VatAudience) {
      let country = current.country;
      if (audience === 'personal' && country === 'OUT') {
        const guess = browserGuess();
        country = guess === 'OUT' ? 'IT' : guess;
      }
      update({ audience, country });
    },
    setCountry(country: string) {
      update({ ...current, country });
    },
    /** Test-only: re-read storage after a test seeds localStorage. */
    reload() {
      current = load();
      set(current);
    },
  };
}

export const billingVat = createStore();
