import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

const { list, create, updateState, getState, reset, getSignal } = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  updateState: vi.fn(),
  getState: vi.fn(),
  reset: vi.fn(),
  getSignal: vi.fn(),
}));

vi.mock('$lib/api/api-keys', () => ({ apiKeysAPI: { list, create } }));
vi.mock('$lib/api/first-signal', () => ({ firstSignalAPI: { get: getSignal } }));
vi.mock('$lib/api/onboarding', () => ({
  OnboardingAPI: class {
    updateState = updateState;
    getState = getState;
    reset = reset;
  },
}));
vi.mock('$lib/stores/checklist', () => ({
  checklistStore: { completeItem: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
vi.mock('$lib/utils/clipboard', () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));

import ConnectStep from './ConnectStep.svelte';
import { onboardingStore } from '$lib/stores/onboarding';

const noSignal = {
  logs: false,
  traces: false,
  metrics: false,
  errors: false,
  firstAt: null,
  lastEventAt: null,
};

beforeEach(async () => {
  list.mockReset();
  create.mockReset();
  getSignal.mockReset().mockResolvedValue(noSignal);
  updateState.mockReset().mockResolvedValue({});
  reset.mockReset().mockResolvedValue({});
  getState.mockReset().mockResolvedValue({
    tutorialCompleted: false,
    tutorialSkipped: false,
    tutorialStep: 0,
    step: null,
    organizationId: null,
    projectId: null,
  });
  await onboardingStore.reset();
  onboardingStore.hydrate({ step: 'connect', organizationId: 'o1', projectId: 'p1' });
});

describe('ConnectStep', () => {
  it('auto-creates exactly one write key when the project has none', async () => {
    list.mockResolvedValue({ apiKeys: [] });
    create.mockResolvedValue({ id: 'k1', apiKey: 'lp_abcdef123', keyPrefix: 'lp_abcdef', type: 'write', message: '' });
    render(ConnectStep);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith('p1', { name: 'Onboarding key', type: 'write' });
    await waitFor(() => expect(screen.getByTestId('api-key-value').textContent).toBe('lp_abcdef123'));
    expect(screen.getByText(/shown once/)).toBeInTheDocument();
  });

  it('does not auto-create when keys exist and shows Create a new key', async () => {
    list.mockResolvedValue({ apiKeys: [{ id: 'k0', revoked: false }] });
    render(ConnectStep);
    await screen.findByRole('button', { name: 'Create a new key' });
    expect(create).not.toHaveBeenCalled();

    create.mockResolvedValue({ id: 'k1', apiKey: 'lp_new', keyPrefix: 'lp_new', type: 'write', message: '' });
    await fireEvent.click(screen.getByRole('button', { name: 'Create a new key' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  it('treats only revoked keys as no keys', async () => {
    list.mockResolvedValue({ apiKeys: [{ id: 'k0', revoked: true }] });
    create.mockResolvedValue({ id: 'k1', apiKey: 'lp_x', keyPrefix: 'lp_x', type: 'write', message: '' });
    render(ConnectStep);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  it('capability error shows an inline message and Skip for now still advances', async () => {
    list.mockResolvedValue({ apiKeys: [] });
    create.mockRejectedValue(new Error('API key limit reached for your plan'));
    render(ConnectStep);
    await waitFor(() => expect(screen.getByText('API key limit reached for your plan')).toBeTruthy());
    expect(screen.getByRole('link', { name: 'project settings' }).getAttribute('href')).toBe(
      '/dashboard/projects/p1/settings#api-keys'
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(get(onboardingStore).step).toBe('done'));
  });

  it('renders snippets with the created key', async () => {
    list.mockResolvedValue({ apiKeys: [] });
    create.mockResolvedValue({ id: 'k1', apiKey: 'lp_snippetkey', keyPrefix: 'lp_snippe', type: 'write', message: '' });
    render(ConnectStep);
    await waitFor(() => expect(document.body.textContent).toContain('npm install @logtide/core'));
    await waitFor(() => expect(document.body.textContent).toMatch(/dsn: "[^"]*lp_snippetkey@/));
  });

  it('onDetected enables Continue', async () => {
    list.mockResolvedValue({ apiKeys: [{ id: 'k0', revoked: false }] });
    getSignal.mockResolvedValue({ ...noSignal, logs: true });
    render(ConnectStep);
    await screen.findByText('Received logs');
    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button).not.toBeDisabled();
    await fireEvent.click(button);
    await waitFor(() => expect(get(onboardingStore).step).toBe('done'));
  });

  it('Continue is disabled until a signal arrives', async () => {
    list.mockResolvedValue({ apiKeys: [{ id: 'k0', revoked: false }] });
    render(ConnectStep);
    await screen.findByRole('button', { name: 'Create a new key' });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});
