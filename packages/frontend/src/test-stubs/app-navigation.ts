// Test stub for SvelteKit's $app/navigation virtual module, which does not
// resolve under plain vitest. Aliased in vitest.config.ts. Tests can
// vi.mock('$app/navigation', ...) to assert on navigation per case.
export const goto = async (_url: string | URL): Promise<void> => {};
export const invalidate = async (): Promise<void> => {};
export const invalidateAll = async (): Promise<void> => {};
export const beforeNavigate = (_cb: unknown): void => {};
export const afterNavigate = (_cb: unknown): void => {};
