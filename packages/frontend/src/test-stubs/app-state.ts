// Minimal stand-in for SvelteKit's $app/state under plain vitest. Tests set
// page.url to drive components that read query parameters.
export const page: { url: URL } = {
  url: new URL('http://localhost/'),
};
