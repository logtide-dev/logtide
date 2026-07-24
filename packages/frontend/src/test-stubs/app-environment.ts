// Test stub for SvelteKit's $app/environment virtual module, which does not
// resolve under plain vitest. Aliased in vitest.config.ts. Defaults to a browser
// context so client-only paths (localStorage, etc.) run; individual tests can
// still vi.mock('$app/environment', ...) to override per case.
export const browser = true;
export const dev = false;
export const building = false;
export const version = 'test';
