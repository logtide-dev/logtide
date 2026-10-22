import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SuggestInput from './SuggestInput.svelte';

const OPTIONS = ['cpu_usage', 'cpu_idle', 'memory_used'];

function setup(props: Partial<{ value: string; options: string[] }> = {}) {
  const onChange = vi.fn();
  render(SuggestInput, {
    props: { value: '', options: OPTIONS, placeholder: 'Metric', onChange, ...props },
  });
  return { onChange, input: screen.getByPlaceholderText('Metric') as HTMLInputElement };
}

describe('SuggestInput', () => {
  it('filters options by substring', async () => {
    const { input } = setup({ value: 'cpu' });
    await fireEvent.focus(input);
    expect(await screen.findByText('cpu_usage')).toBeInTheDocument();
    expect(screen.getByText('cpu_idle')).toBeInTheDocument();
    expect(screen.queryByText('memory_used')).not.toBeInTheDocument();
  });

  it('accepts a value that is not in the list', async () => {
    const { input, onChange } = setup();
    await fireEvent.input(input, { target: { value: 'my.custom.metric' } });
    expect(onChange).toHaveBeenCalledWith('my.custom.metric');
  });

  it('Enter on highlighted option calls onChange', async () => {
    const { input, onChange } = setup({ value: 'cpu' });
    await fireEvent.focus(input);
    await screen.findByText('cpu_usage');
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('cpu_idle');
  });

  it('clicking an option calls onChange', async () => {
    const { input, onChange } = setup({ value: 'mem' });
    await fireEvent.focus(input);
    await fireEvent.click(await screen.findByText('memory_used'));
    expect(onChange).toHaveBeenCalledWith('memory_used');
  });

  it('renders with empty options', async () => {
    const { input } = setup({ options: [] });
    await fireEvent.focus(input);
    expect(input).toBeInTheDocument();
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('Enter with no open list keeps free typing', async () => {
    const { input, onChange } = setup({ value: 'zzz' });
    await fireEvent.focus(input);
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
