import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import ColumnConfigMenu from './ColumnConfigMenu.svelte';
import { DEFAULT_BUILTIN_LAYOUT, type BuiltinColumnLayout } from './builtin-columns';

function setup(props: { columns?: string[]; layout?: BuiltinColumnLayout } = {}) {
  const onchange = vi.fn();
  const onLayoutChange = vi.fn();
  const utils = render(ColumnConfigMenu, {
    props: {
      columns: props.columns ?? [],
      layout: props.layout ?? DEFAULT_BUILTIN_LAYOUT,
      onchange,
      onLayoutChange,
    },
  });
  return { ...utils, onchange, onLayoutChange };
}

async function open(utils: ReturnType<typeof setup>) {
  await fireEvent.click(utils.getByRole('button', { name: 'Configure columns' }));
  await tick();
}

describe('ColumnConfigMenu', () => {
  it('toggles built-in column visibility', async () => {
    const utils = setup();
    await open(utils);
    await fireEvent.click(await utils.findByRole('checkbox', { name: 'Host' }));
    expect(utils.onLayoutChange).toHaveBeenCalledTimes(1);
    expect(utils.onLayoutChange.mock.calls[0][0].hidden).toEqual(['host']);
    expect(utils.getByRole('checkbox', { name: 'Message' })).toBeDisabled();
  });

  it('shows hidden columns unchecked', async () => {
    const utils = setup({ layout: { order: DEFAULT_BUILTIN_LAYOUT.order, hidden: ['service'] } });
    await open(utils);
    expect(await utils.findByRole('checkbox', { name: 'Service' })).toHaveAttribute('aria-checked', 'false');
    expect(utils.getByRole('checkbox', { name: 'Time' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves built-in columns', async () => {
    const utils = setup();
    await open(utils);
    await fireEvent.click(await utils.findByRole('button', { name: 'Move time column down' }));
    expect(utils.onLayoutChange).toHaveBeenCalledTimes(1);
    expect(utils.onLayoutChange.mock.calls[0][0].order[1]).toBe('time');
  });

  it('disables moves past the edges', async () => {
    const utils = setup();
    await open(utils);
    expect(await utils.findByRole('button', { name: 'Move time column up' })).toBeDisabled();
    expect(utils.getByRole('button', { name: 'Move message column down' })).toBeDisabled();
  });

  it('still adds metadata columns', async () => {
    const utils = setup();
    await open(utils);
    const input = await utils.findByPlaceholderText('e.g. sdk.name');
    await fireEvent.input(input, { target: { value: 'sdk.name' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(utils.onchange).toHaveBeenCalledWith(['sdk.name']);
  });

  it('removes metadata columns', async () => {
    const utils = setup({ columns: ['sdk.name', 'user.id'] });
    await open(utils);
    await fireEvent.click(await utils.findByRole('button', { name: 'Remove sdk.name column' }));
    expect(utils.onchange).toHaveBeenCalledWith(['user.id']);
  });

  it('labels the add button', async () => {
    const utils = setup();
    await open(utils);
    expect(await utils.findByRole('button', { name: 'Add column' })).toBeTruthy();
  });
});
