import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

const validateYaml = vi.hoisted(() => vi.fn());
const importRule = vi.hoisted(() => vi.fn());

vi.mock('$lib/api/sigma', () => ({ sigmaAPI: { validateYaml, importRule } }));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('$lib/components/notification-channels', async () => {
  const stub = (await import('./test-stub.svelte')).default;
  return { ChannelSelector: stub };
});
vi.mock('$lib/components/notification-channels/WillNotify.svelte', async () => ({
  default: (await import('./test-stub.svelte')).default,
}));

import ImportRuleDialog from './ImportRuleDialog.svelte';

async function typeYaml(text: string) {
  const area = screen.getByLabelText('Rule YAML');
  await fireEvent.input(area, { target: { value: text } });
}

beforeEach(() => {
  vi.useFakeTimers();
  validateYaml.mockReset();
  importRule.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ImportRuleDialog', () => {
  it('shows validation errors from validateYaml', async () => {
    validateYaml.mockResolvedValue({ valid: false, errors: ['Missing detection'], warnings: [] });
    render(ImportRuleDialog, { open: true, organizationId: 'org-1', onImported: vi.fn() });
    await typeYaml('title: x');
    await vi.advanceTimersByTimeAsync(600);
    expect(validateYaml).toHaveBeenCalledWith('org-1', 'title: x');
    expect(screen.getByText('Missing detection')).toBeInTheDocument();
  });

  it('submit disabled while invalid', async () => {
    validateYaml.mockResolvedValue({ valid: false, errors: ['bad'], warnings: [] });
    render(ImportRuleDialog, { open: true, organizationId: 'org-1', onImported: vi.fn() });
    expect(screen.getByRole('button', { name: 'Import rule' })).toBeDisabled();
    await typeYaml('title: x');
    await vi.advanceTimersByTimeAsync(600);
    expect(screen.getByRole('button', { name: 'Import rule' })).toBeDisabled();
  });

  it('successful import calls onImported with the id', async () => {
    validateYaml.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
      summary: { title: 'Login', level: 'high', tags: [] },
    });
    importRule.mockResolvedValue({ sigmaRule: { id: 'rule-9' }, warnings: [], errors: [] });
    const onImported = vi.fn();
    render(ImportRuleDialog, { open: true, organizationId: 'org-1', onImported });
    await typeYaml('title: Login');
    await vi.advanceTimersByTimeAsync(600);
    expect(screen.getByText(/Valid rule: Login/)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Import rule' });
    expect(btn).toBeEnabled();
    await fireEvent.click(btn);
    await vi.advanceTimersByTimeAsync(0);
    expect(importRule).toHaveBeenCalledWith({
      yaml: 'title: Login',
      organizationId: 'org-1',
      channelIds: undefined,
    });
    expect(onImported).toHaveBeenCalledWith('rule-9');
  });

  it('file upload fills the textarea', async () => {
    validateYaml.mockResolvedValue({ valid: true, errors: [], warnings: [] });
    render(ImportRuleDialog, { open: true, organizationId: 'org-1', onImported: vi.fn() });
    const file = new File(['title: From file'], 'rule.yml', { type: 'text/yaml' });
    const input = screen.getByTestId('rule-file-input');
    await fireEvent.change(input, { target: { files: [file] } });
    await vi.advanceTimersByTimeAsync(0);
    expect((screen.getByLabelText('Rule YAML') as HTMLTextAreaElement).value).toBe('title: From file');
  });
});
