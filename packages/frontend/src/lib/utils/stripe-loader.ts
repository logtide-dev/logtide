import type { Stripe } from '@stripe/stripe-js';

const cache = new Map<string, Promise<Stripe | null>>();

/**
 * Loads Stripe.js once per publishable key. The library is imported lazily
 * (`pure` does not inject the script on import), so nothing from Stripe is
 * fetched until a checkout dialog actually opens. A failed load is not cached,
 * so the next attempt can retry.
 */
export function loadStripeOnce(publishableKey: string): Promise<Stripe | null> {
  let pending = cache.get(publishableKey);
  if (!pending) {
    pending = import('@stripe/stripe-js/pure')
      .then(({ loadStripe }) => loadStripe(publishableKey))
      .catch((e) => {
        cache.delete(publishableKey);
        throw e;
      });
    cache.set(publishableKey, pending);
  }
  return pending;
}
