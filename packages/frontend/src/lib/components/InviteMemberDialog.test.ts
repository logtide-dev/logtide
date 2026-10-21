import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

import InviteMemberDialog from './InviteMemberDialog.svelte';

describe('InviteMemberDialog', () => {
  it('member helper text names what members cannot change', () => {
    render(InviteMemberDialog, { props: { open: true, onSubmit: vi.fn() } });
    const text = document.body.textContent ?? '';
    expect(text).toContain(
      'Members can view and use all organization data. They cannot change PII masking, pipelines, notifications or members.'
    );
    expect(text).not.toContain('cannot manage team settings');
  });

  it('admin helper text is unchanged', async () => {
    render(InviteMemberDialog, { props: { open: true, onSubmit: vi.fn() } });
    await fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'admin' } });
    expect(document.body.textContent).toContain(
      'Admins can invite members, manage roles, and remove members (except the owner).'
    );
  });

  it('uses sentence case labels', () => {
    render(InviteMemberDialog, { props: { open: true, onSubmit: vi.fn() } });
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeInTheDocument();
    expect(screen.getByText('Invite member')).toBeInTheDocument();
  });
});
