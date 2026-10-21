import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import CustomRangeEditor from './CustomRangeEditor.svelte';

const from = new Date('2026-10-21T10:00:00Z');
const to = new Date('2026-10-21T11:00:00Z');

function setup(zone = 'Europe/Rome') {
  const onApply = vi.fn();
  const utils = render(CustomRangeEditor, { props: { from, to, zone, onApply } });
  return { onApply, ...utils };
}

describe('CustomRangeEditor', () => {
  it('shows wall clock in the given zone', () => {
    const { getByLabelText } = setup('Europe/Rome');
    expect((getByLabelText('From') as HTMLInputElement).value).toBe('2026-10-21T12:00');
    expect((getByLabelText('To') as HTMLInputElement).value).toBe('2026-10-21T13:00');
  });

  it('emits ISO instants on valid change', async () => {
    const { getByLabelText, onApply } = setup('Europe/Rome');
    await fireEvent.change(getByLabelText('To'), { target: { value: '2026-10-21T14:00' } });
    expect(onApply).toHaveBeenCalledTimes(1);
    const arg = onApply.mock.calls[0][0];
    expect(arg.to.toISOString()).toBe('2026-10-21T12:00:00.000Z');
    expect(arg.from.toISOString()).toBe('2026-10-21T10:00:00.000Z');
  });

  it('rejects inverted range', async () => {
    const { getByLabelText, getByRole, onApply } = setup('UTC');
    await fireEvent.change(getByLabelText('To'), { target: { value: '2026-10-21T09:00' } });
    expect(getByRole('alert').textContent).toBe('End must be after start');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('rejects empty input', async () => {
    const { getByLabelText, getByRole, onApply } = setup('UTC');
    await fireEvent.change(getByLabelText('From'), { target: { value: '' } });
    expect(getByRole('alert').textContent).toBe('Enter a valid date and time');
    expect(onApply).not.toHaveBeenCalled();
  });
});
