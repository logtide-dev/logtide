import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

const validateYaml = vi.hoisted(() => vi.fn());
const updateRuleYaml = vi.hoisted(() => vi.fn());

vi.mock('$lib/api/sigma', () => ({ sigmaAPI: { validateYaml, updateRuleYaml } }));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import RuleYamlPanel from './RuleYamlPanel.svelte';

const base = {
  yaml: 'title: Login\nlevel: high',
  reconstructed: false,
  editable: true,
  organizationId: 'org-1',
  ruleId: 'rule-1',
};

async function edit(text: string) {
  await fireEvent.click(screen.getByRole('button', { name: 'Edit YAML' }));
  await fireEvent.input(screen.getByLabelText('Rule YAML'), { target: { value: text } });
}

beforeEach(() => {
  vi.useFakeTimers();
  validateYaml.mockReset();
  updateRuleYaml.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RuleYamlPanel', () => {
  it('shows the reconstructed note', () => {
    render(RuleYamlPanel, { ...base, reconstructed: true, onSaved: vi.fn() });
    expect(
      screen.getByText('Reconstructed from the stored rule (the original text was not saved)'),
    ).toBeInTheDocument();
  });

  it('does not show the note for stored text', () => {
    render(RuleYamlPanel, { ...base, onSaved: vi.fn() });
    expect(screen.queryByText(/Reconstructed from the stored rule/)).toBeNull();
  });

  it('Edit button hidden when not editable', () => {
    render(RuleYamlPanel, { ...base, editable: false, onSaved: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Edit YAML' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy YAML' })).toBeInTheDocument();
  });

  it('save is disabled while validation errors exist', async () => {
    validateYaml.mockResolvedValue({ valid: false, errors: ['Missing detection'], warnings: [] });
    render(RuleYamlPanel, { ...base, onSaved: vi.fn() });
    await edit('title: Broken');
    await vi.advanceTimersByTimeAsync(600);
    expect(screen.getByText('Missing detection')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('save calls updateRuleYaml with the edited text and then onSaved', async () => {
    validateYaml.mockResolvedValue({ valid: true, errors: [], warnings: [] });
    updateRuleYaml.mockResolvedValue({ rule: {} });
    const onSaved = vi.fn();
    render(RuleYamlPanel, { ...base, onSaved });
    await edit('title: Better');
    await vi.advanceTimersByTimeAsync(600);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    await fireEvent.click(save);
    await vi.advanceTimersByTimeAsync(0);
    expect(updateRuleYaml).toHaveBeenCalledWith('rule-1', 'org-1', 'title: Better');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('cancel with changes asks to discard', async () => {
    validateYaml.mockResolvedValue({ valid: true, errors: [], warnings: [] });
    render(RuleYamlPanel, { ...base, onSaved: vi.fn() });
    await edit('title: Changed');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Discard changes?')).toBeInTheDocument();
  });

  it('cancel without changes leaves edit mode directly', async () => {
    render(RuleYamlPanel, { ...base, onSaved: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit YAML' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit YAML' })).toBeInTheDocument();
  });
});
