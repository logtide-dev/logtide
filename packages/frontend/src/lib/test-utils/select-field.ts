// Drives the design system Select (bits-ui) in jsdom, where a plain
// fireEvent.change on a <select> no longer applies.
import { expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';

/** Opens the Select whose trigger is `trigger` and returns its option labels. */
export async function openSelect(trigger: HTMLElement): Promise<string[]> {
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
  return screen.getAllByRole('option').map((o) => o.textContent?.trim() ?? '');
}

/** Opens the Select and picks the option whose accessible name is `name`. */
export async function chooseSelectOption(trigger: HTMLElement, name: string | RegExp): Promise<void> {
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name });
  await fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
}
