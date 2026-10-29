// Reactive stand-in for SvelteKit's `$app/state` page, used by component tests
// that need `page.url` changes (from a mocked `goto`) to re-run effects.
export const page = $state<{ url: URL }>({ url: new URL('http://localhost/dashboard/traces') });

export function setPageUrl(search: string): void {
  page.url = new URL(`http://localhost/dashboard/traces${search}`);
}
