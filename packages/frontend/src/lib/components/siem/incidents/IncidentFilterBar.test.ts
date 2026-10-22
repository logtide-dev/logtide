import { describe, it, expect, vi, type Mock } from 'vitest';
import type { ComponentProps } from 'svelte';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import IncidentFilterBar from './IncidentFilterBar.svelte';

type P = ComponentProps<typeof IncidentFilterBar>;
type Props = P & { onChange: Mock; onReset: Mock };

function props(over: Partial<P> = {}): Props {
  return {
    status: ['open', 'investigating'],
    severity: [],
    source: [],
    assignee: 'anyone',
    onChange: vi.fn(),
    onReset: vi.fn(),
    ...over,
  } as Props;
}

describe('IncidentFilterBar', () => {
  it('renders Acknowledged not Investigating', () => {
    render(IncidentFilterBar, { props: props() });
    expect(screen.getByText('Open, Acknowledged')).toBeTruthy();
    expect(screen.queryByText(/Investigating/)).toBeNull();
  });

  it('selecting a source calls onChange({source:[...]})', async () => {
    const p = props();
    render(IncidentFilterBar, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: /Source/ }));
    const box = await screen.findByRole('checkbox', { name: 'Alert' });
    await fireEvent.click(box);
    await waitFor(() => expect(p.onChange).toHaveBeenCalledWith({ source: ['alert'] }));
  });

  it('unchecking every status falls back to all', async () => {
    const p = props({ status: ['open'] });
    render(IncidentFilterBar, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: /Status/ }));
    await fireEvent.click(await screen.findByRole('checkbox', { name: 'Open' }));
    await waitFor(() => expect(p.onChange).toHaveBeenCalledWith({ status: 'all' }));
  });

  it('Me button emits assignee me', async () => {
    const p = props();
    render(IncidentFilterBar, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Me' }));
    expect(p.onChange).toHaveBeenCalledWith({ assignee: 'me' });
    expect(screen.getByRole('button', { name: 'Anyone' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('ruleId chip removable emits ruleId undefined', async () => {
    const p = props({ ruleId: 'rule-1' });
    render(IncidentFilterBar, { props: p });
    expect(screen.getByText('rule-1')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove rule filter' }));
    expect(p.onChange).toHaveBeenCalledWith({ ruleId: undefined });
  });

  it('reset button hidden at defaults and shown otherwise', async () => {
    const { unmount } = render(IncidentFilterBar, { props: props() });
    expect(screen.queryByRole('button', { name: 'Reset filters' })).toBeNull();
    unmount();
    const p = props({ severity: ['high'] });
    render(IncidentFilterBar, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(p.onReset).toHaveBeenCalledTimes(1);
  });
});
