import type { Locator } from '@playwright/test';

/**
 * Picks an option of a design system Select. The option list is portaled to
 * the end of <body>, so it is looked up on the page, not inside the trigger.
 */
export async function pickOption(trigger: Locator, name: string | RegExp): Promise<void> {
  await trigger.click();
  await trigger.page().getByRole('option', { name, exact: typeof name === 'string' }).click();
}
