import { describe, it, expect } from 'vitest';
import {
  PROJECT_TRASH_RETENTION_DAYS,
  PROJECT_TRASH_DIALOG_TEXT,
  PROJECT_TRASH_TOAST,
} from './project-trash';

describe('project trash copy', () => {
  it('keeps the retention at 30 days', () => {
    expect(PROJECT_TRASH_RETENTION_DAYS).toBe(30);
  });

  it('names the project and states what is permanently deleted', () => {
    const text = PROJECT_TRASH_DIALOG_TEXT('Checkout');
    expect(text).toBe(
      'Checkout stops accepting data and moves to the trash. You can restore it within 30 days. After that its logs, traces, metrics, API keys and alert rules are permanently deleted.'
    );
  });

  it('toast has no "successfully" and no exclamation mark', () => {
    expect(PROJECT_TRASH_TOAST).toBe(
      'Project moved to trash. Restore it from the projects list within 30 days.'
    );
    expect(PROJECT_TRASH_TOAST).not.toMatch(/successfully|!/);
  });
});
