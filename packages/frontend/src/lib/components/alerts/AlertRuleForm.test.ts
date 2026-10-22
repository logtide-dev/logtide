import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';

const routingPreview = vi.hoisted(() => vi.fn());

vi.mock('$lib/api/notification-routing', () => ({
  notificationRoutingAPI: { preview: routingPreview },
}));

vi.mock('$lib/stores/organization', async () => {
  const { writable } = await import('svelte/store');
  return { organizationStore: writable({ currentOrganization: { id: 'org-1' } }) };
});

vi.mock('$lib/stores/notification-channels', async () => {
  const { writable } = await import('svelte/store');
  const store = writable({ channels: [], loading: false, error: null });
  return { notificationChannelsStore: { subscribe: store.subscribe, load: vi.fn() } };
});

vi.mock('$lib/api/alerts', async (orig) => {
  const actual = await orig<typeof import('$lib/api/alerts')>();
  return {
    ...actual,
    alertsAPI: { previewAlertRule: vi.fn().mockResolvedValue({ preview: null }) },
  };
});

import AlertRuleForm from './AlertRuleForm.svelte';
import { alertsAPI } from '$lib/api/alerts';

const projects = [
  { id: 'p1', name: 'Web' },
  { id: 'p2', name: 'API' },
];

function mount(props: Record<string, unknown> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const utils = render(AlertRuleForm, {
    props: {
      mode: 'create',
      organizationId: 'org-1',
      projects,
      submitting: false,
      submitLabel: 'Create alert',
      onSubmit,
      onCancel,
      initial: { name: 'High errors', channelIds: ['c1'] },
      ...props,
    },
  });
  return { onSubmit, onCancel, ...utils };
}

beforeEach(() => {
  routingPreview.mockReset();
  routingPreview.mockResolvedValue({ destinations: [], fallback: false });
});

afterEach(() => {
  cleanup();
});

describe('AlertRuleForm', () => {
  it('renders Scope with All projects and each project', () => {
    mount();
    const select = screen.getByLabelText('Scope') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['All projects', 'Web', 'API']);
  });

  it('locked project shows read-only scope', () => {
    mount({ lockedProjectId: 'p2' });
    expect(screen.getByTestId('scope-readonly').textContent).toBe('API');
    expect(screen.queryByLabelText('Scope')).toBeNull();
  });

  it('edit mode shows scope read-only with the explanation', () => {
    mount({ mode: 'edit', initial: { name: 'x', projectId: 'p1', channelIds: ['c1'] } });
    expect(screen.getByTestId('scope-readonly').textContent).toBe('Web');
    expect(screen.getByText('Scope cannot be changed after creation')).toBeTruthy();
  });

  it('typing an invalid query shows the error message with its position and blocks submit', async () => {
    const { onSubmit } = mount();
    await fireEvent.input(screen.getByLabelText('Query'), { target: { value: 'a:1 OR b:2' } });
    const alert = await screen.findByText(/\(position \d+\)/);
    expect(alert.textContent).toMatch(/position \d+/);
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('valid query passes through onSubmit as query', async () => {
    const { onSubmit } = mount();
    await fireEvent.input(screen.getByLabelText('Query'), { target: { value: 'timeout OR refused' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.query).toBe('timeout OR refused');
    expect(payload.projectId).toBeNull();
    expect(payload.channelIds).toEqual(['c1']);
  });

  it('query field disabled for rate_of_change and omitted from the payload', async () => {
    const { onSubmit } = mount({ initial: { name: 'Anomaly', channelIds: ['c1'], query: 'timeout' } });
    await fireEvent.click(screen.getByRole('button', { name: /Rate of change/ }));
    expect((screen.getByLabelText('Query') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Text queries apply to threshold rules only')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    const payload = onSubmit.mock.calls[0][0];
    expect('query' in payload).toBe(false);
    expect('renotifyMinutes' in payload).toBe(false);
    expect(payload.alertType).toBe('rate_of_change');
  });

  it('renotify select appears for threshold only and emits minutes or null', async () => {
    const { onSubmit } = mount();
    const select = screen.getByLabelText('Renotify') as HTMLSelectElement;
    expect(select.value).toBe('');
    await fireEvent.change(select, { target: { value: '240' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(onSubmit.mock.calls[0][0].renotifyMinutes).toBe(240);

    onSubmit.mockClear();
    await fireEvent.change(select, { target: { value: '' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(onSubmit.mock.calls[0][0].renotifyMinutes).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: /Rate of change/ }));
    expect(screen.queryByLabelText('Renotify')).toBeNull();
  });

  it('WillNotify rendered with eventType alert, the chosen project and selected channel ids', async () => {
    mount();
    await fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'p2' } });
    await waitFor(
      () =>
        expect(routingPreview).toHaveBeenLastCalledWith(
          { organizationId: 'org-1', eventType: 'alert', projectId: 'p2', channelIds: ['c1'] },
          expect.anything()
        ),
      { timeout: 2000 }
    );
  });

  it('submit without a channel shows "Select at least one channel"', async () => {
    const { onSubmit } = mount({ initial: { name: 'No channel' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(await screen.findByText('Select at least one channel')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('preview button disabled while the query is invalid', async () => {
    mount();
    const button = screen.getByRole('button', { name: /Preview alert behavior/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await fireEvent.input(screen.getByLabelText('Query'), { target: { value: 'a:1 OR b:2' } });
    await waitFor(() => expect(button.disabled).toBe(true));
  });

  it('preview is shown in edit mode and sends the query', async () => {
    mount({ mode: 'edit', initial: { name: 'x', projectId: 'p1', channelIds: ['c1'], query: 'timeout' } });
    const button = screen.getByRole('button', { name: /Preview alert behavior/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await fireEvent.click(button);
    await waitFor(() => expect(alertsAPI.previewAlertRule).toHaveBeenCalled());
    const arg = (alertsAPI.previewAlertRule as any).mock.calls[0][0];
    expect(arg.query).toBe('timeout');
    expect(arg.projectId).toBe('p1');
  });

  it('levels are toggle buttons with aria-pressed', async () => {
    mount();
    const error = screen.getByRole('button', { name: 'error' });
    const debug = screen.getByRole('button', { name: 'debug' });
    expect(error.getAttribute('aria-pressed')).toBe('true');
    expect(debug.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(debug);
    expect(debug.getAttribute('aria-pressed')).toBe('true');
  });

  it('copy is sentence case', () => {
    mount();
    for (const label of ['Alert name', 'Service', 'Time window']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByText('Log levels')).toBeTruthy();
    expect(screen.queryByText('Alert Name *')).toBeNull();
  });
});
