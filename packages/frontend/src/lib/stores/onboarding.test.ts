import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

const { getState, updateState, reset } = vi.hoisted(() => ({
  getState: vi.fn(),
  updateState: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('$lib/api/onboarding', () => ({
  OnboardingAPI: class {
    getState = getState;
    updateState = updateState;
    reset = reset;
  },
}));

vi.mock('./checklist', () => ({
  checklistStore: { completeItem: vi.fn().mockResolvedValue(undefined) },
}));

import { onboardingStore, ONBOARDING_STEPS } from './onboarding';

describe('onboardingStore', () => {
  beforeEach(async () => {
    getState.mockReset();
    updateState.mockReset();
    reset.mockReset();
    updateState.mockResolvedValue({});
    reset.mockResolvedValue({});
    getState.mockResolvedValue({
      tutorialCompleted: false,
      tutorialSkipped: false,
      tutorialStep: 0,
      step: null,
      organizationId: null,
      projectId: null,
    });
    await onboardingStore.reset();
    updateState.mockClear();
  });

  it('setWorkspace persists org and project ids through updateState', async () => {
    await onboardingStore.setWorkspace({ organizationId: 'o1', projectId: 'p1' });
    expect(updateState).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'o1', projectId: 'p1' })
    );
    expect(get(onboardingStore).organizationId).toBe('o1');
  });

  it('setWorkspace with only an org does not send a project id', async () => {
    await onboardingStore.setWorkspace({ organizationId: 'o1' });
    const payload = updateState.mock.calls[0][0];
    expect(payload.organizationId).toBe('o1');
    expect(payload.projectId).toBeUndefined();
  });

  it('goToStep persists step and the tutorialStep index', async () => {
    await onboardingStore.goToStep('connect');
    expect(updateState).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'connect', tutorialStep: ONBOARDING_STEPS.indexOf('connect') })
    );
    expect(get(onboardingStore).step).toBe('connect');
  });

  it('persist failure does not throw', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    updateState.mockRejectedValue(new Error('offline'));
    await expect(onboardingStore.goToStep('done')).resolves.toBeUndefined();
    expect(get(onboardingStore).step).toBe('done');
    spy.mockRestore();
  });

  it('keeps the api key in memory only', async () => {
    onboardingStore.setApiKey('lp_secret');
    expect(get(onboardingStore).apiKey).toBe('lp_secret');
    await onboardingStore.goToStep('connect');
    expect(JSON.stringify(updateState.mock.calls)).not.toContain('lp_secret');
  });

  it('complete marks tutorialCompleted', async () => {
    await onboardingStore.complete();
    expect(updateState).toHaveBeenCalledWith(expect.objectContaining({ tutorialCompleted: true, step: 'done' }));
    expect(get(onboardingStore).completed).toBe(true);
  });

  it('load returns the raw server shape', async () => {
    getState.mockResolvedValue({
      tutorialCompleted: false,
      tutorialSkipped: false,
      tutorialStep: 2,
      step: 'connect',
      organizationId: 'o1',
      projectId: 'p1',
    });
    await expect(onboardingStore.load()).resolves.toEqual({
      step: 'connect',
      organizationId: 'o1',
      projectId: 'p1',
      completed: false,
      skipped: false,
    });
  });

  it('reset clears local state', async () => {
    await onboardingStore.setWorkspace({ organizationId: 'o1', projectId: 'p1' });
    await onboardingStore.reset();
    const s = get(onboardingStore);
    expect(s.organizationId).toBeNull();
    expect(s.projectId).toBeNull();
    expect(s.step).toBeNull();
    expect(reset).toHaveBeenCalled();
  });
});
