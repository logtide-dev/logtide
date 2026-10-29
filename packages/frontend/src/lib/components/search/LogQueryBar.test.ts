import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import LogQueryBar from './LogQueryBar.svelte';

function setup(p: Record<string, unknown> = {}) {
  const onSubmit = vi.fn();
  const onEdit = vi.fn();
  const utils = render(LogQueryBar, {
    props: { value: '', fields: [] as string[], valuesFor: () => [] as string[], onSubmit, onEdit, ...p },
  });
  const input = screen.getByRole('combobox', { name: 'Log query' }) as HTMLInputElement;
  return { ...utils, input, onSubmit, onEdit };
}

async function type(input: HTMLInputElement, value: string) {
  await fireEvent.input(input, { target: { value } });
  await tick();
}

async function key(input: HTMLInputElement, k: string) {
  await fireEvent.keyDown(input, { key: k });
  await tick();
}

describe('LogQueryBar', () => {
  it('renders highlighted token segments', () => {
    const { container, input } = setup({ value: 'level:error timeout' });
    const overlay = container.querySelector('[data-testid="log-query-overlay"]');
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[data-kind="field"]')?.textContent).toBe('level:error');
    expect(container.querySelector('[data-kind="word"]')?.textContent).toBe('timeout');
    expect(input.id).toBe('search');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
  });

  it('submits on Enter when the query parses', async () => {
    const { input, onSubmit } = setup();
    await type(input, 'timeout');
    await key(input, 'Enter');
    expect(onSubmit).toHaveBeenCalledWith('timeout');
  });

  it('submits a complete clause instead of re-accepting its own value', async () => {
    const { input, onSubmit } = setup();
    await type(input, 'level:error');
    await key(input, 'Enter');
    expect(onSubmit).toHaveBeenCalledWith('level:error');
    expect(input.value).toBe('level:error');
  });

  it('refuses Enter on a parse error and shows the message', async () => {
    const { input, onSubmit, container } = setup();
    await type(input, 'level:(');
    await key(input, 'Escape');
    await key(input, 'Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('position');
    expect(screen.getByRole('alert').textContent).toContain('Unclosed parenthesis');
    expect(container.querySelector('.decoration-wavy')).not.toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows a parse error politely while typing', async () => {
    const { input } = setup();
    await type(input, '"conn');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Unclosed quote (position 1)')).toBeTruthy();
  });

  it('shows the server error until the next edit', async () => {
    const { input, onEdit } = setup({ value: 'service:api', serverError: { message: 'Bad field', position: 0 } });
    expect(screen.getByText('Bad field (position 1)')).toBeTruthy();
    await type(input, 'service:ap');
    expect(screen.queryByText('Bad field (position 1)')).toBeNull();
    expect(onEdit).toHaveBeenCalled();
  });

  it('shows a new server error after an edit', async () => {
    const { input, rerender } = setup({ value: 'a', serverError: { message: 'First', position: 0 } });
    await type(input, 'ab');
    expect(screen.queryByText('First (position 1)')).toBeNull();
    await rerender({ serverError: { message: 'Second', position: 1 } });
    await tick();
    expect(screen.getByText('Second (position 2)')).toBeTruthy();
  });

  it('suggests fields and accepts with Enter', async () => {
    const { input, onSubmit } = setup();
    await type(input, 'lev');
    expect(screen.getByRole('option', { name: 'level' })).toBeTruthy();
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await key(input, 'Enter');
    expect(input.value).toBe('level:');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('offers the values after a field is accepted', async () => {
    const { input } = setup();
    await type(input, 'lev');
    await key(input, 'Enter');
    expect(screen.getAllByRole('option').map((o) => o.textContent?.trim())).toEqual([
      'debug',
      'info',
      'warn',
      'error',
      'critical',
    ]);
  });

  it('suggests facet values', async () => {
    const valuesFor = vi.fn((k: string) => (k === 'service' ? ['api', 'web'] : []));
    const { input } = setup({ valuesFor });
    await type(input, 'service:a');
    expect(screen.getByRole('option', { name: 'api' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'web' })).toBeNull();
    expect(valuesFor).toHaveBeenCalledWith('service');
  });

  it('suggests discovered metadata keys', async () => {
    const { input } = setup({ fields: ['user.id', 'region'] });
    await type(input, 'us');
    expect(screen.getByRole('option', { name: 'user.id' })).toBeTruthy();
  });

  it('moves with the arrow keys and accepts with Tab', async () => {
    const { input } = setup();
    await type(input, 's');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    await key(input, 'ArrowDown');
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id);
    await key(input, 'ArrowUp');
    await key(input, 'ArrowUp');
    expect(screen.getAllByRole('option')[2].getAttribute('aria-selected')).toBe('true');
    await key(input, 'Tab');
    expect(input.value).toBe('span:');
  });

  it('accepts an option on click', async () => {
    const { input } = setup();
    await type(input, 'ser');
    await fireEvent.mouseDown(screen.getByRole('option', { name: 'service' }));
    await tick();
    expect(input.value).toBe('service:');
  });

  it('Escape closes the list without submitting', async () => {
    const { input, onSubmit } = setup();
    await type(input, 'lev');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await key(input, 'Escape');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe('lev');
  });

  it('labels the icon buttons', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Run search' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Query syntax help' })).toBeTruthy();
  });

  it('runs the search from the button', async () => {
    const { onSubmit } = setup({ value: 'timeout' });
    await fireEvent.click(screen.getByRole('button', { name: 'Run search' }));
    expect(onSubmit).toHaveBeenCalledWith('timeout');
  });

  it('opens the syntax help', async () => {
    setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Query syntax help' }));
    expect(await screen.findByText('level:(error OR critical)')).toBeTruthy();
    expect(screen.getByText(/Built-in keys: level, service, host, trace, session, span\./)).toBeTruthy();
  });

  it('disables input and buttons', () => {
    const { input } = setup({ disabled: true });
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run search' })).toBeDisabled();
  });
});
