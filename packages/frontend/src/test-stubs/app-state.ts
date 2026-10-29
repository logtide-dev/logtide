// Minimal stand-in for SvelteKit's $app/state under plain vitest. Tests set
// page.url (and page.params for dynamic routes) to drive components that read
// query parameters.
export const page: { url: URL; params: Record<string, string> } = {
  url: new URL('http://localhost/'),
  params: {},
};
