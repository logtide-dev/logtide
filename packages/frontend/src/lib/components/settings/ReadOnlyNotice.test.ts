import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ReadOnlyNotice from './ReadOnlyNotice.svelte';

describe('ReadOnlyNotice', () => {
  it('defaults to the admin wording', () => {
    render(ReadOnlyNotice, { what: 'log pipelines' });
    expect(screen.getByTestId('read-only-notice').textContent).toContain(
      'Only organization owners and admins can change log pipelines. You can view the current configuration.'
    );
  });

  it('uses the owner wording', () => {
    render(ReadOnlyNotice, { requiredRole: 'owner', what: 'the organization name' });
    expect(screen.getByTestId('read-only-notice').textContent).toContain(
      'Only the organization owner can change the organization name.'
    );
  });
});
