import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { updateCurrentUser, deleteCurrentUser, goto, toast } = vi.hoisted(() => ({
  updateCurrentUser: vi.fn(),
  deleteCurrentUser: vi.fn(),
  goto: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/api/users', () => ({
  UsersAPI: class {
    updateCurrentUser = updateCurrentUser;
    deleteCurrentUser = deleteCurrentUser;
  },
}));
vi.mock('$lib/stores/toast', () => ({ toastStore: toast }));

import Page from './+page.svelte';
import { authStore } from '$lib/stores/auth';

describe('security page', () => {
  beforeEach(() => {
    localStorage.clear();
    updateCurrentUser.mockReset();
    deleteCurrentUser.mockReset();
    goto.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    authStore.setAuth({ id: 'u1', email: 'me@example.com', name: 'Me' } as never, 'tok');
  });

  it('password mismatch toasts and does not call the API', async () => {
    render(Page);
    await fireEvent.input(screen.getByLabelText('Current password'), { target: { value: 'oldpassword' } });
    await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'newpassword1' } });
    await fireEvent.input(screen.getByLabelText('Confirm new password'), { target: { value: 'different1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(toast.error).toHaveBeenCalledWith('Passwords do not match');
    expect(updateCurrentUser).not.toHaveBeenCalled();
  });

  it('changes the password with current and new only', async () => {
    updateCurrentUser.mockResolvedValue({ user: {} });
    render(Page);
    await fireEvent.input(screen.getByLabelText('Current password'), { target: { value: 'oldpassword' } });
    await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'newpassword1' } });
    await fireEvent.input(screen.getByLabelText('Confirm new password'), { target: { value: 'newpassword1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Password changed'));
    expect(updateCurrentUser).toHaveBeenCalledWith({ currentPassword: 'oldpassword', newPassword: 'newpassword1' });
  });

  it('delete is disabled until a password is typed', async () => {
    render(Page);
    const btn = screen.getByRole('button', { name: 'Delete account' });
    expect(btn).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('Confirm your password'), { target: { value: 'pw' } });
    expect(screen.getByRole('button', { name: 'Delete account' })).not.toBeDisabled();
  });

  it('ConfirmDialog requires typing the account email and then calls deleteCurrentUser', async () => {
    deleteCurrentUser.mockResolvedValue(undefined);
    render(Page);
    await fireEvent.input(screen.getByLabelText('Confirm your password'), { target: { value: 'secret-pw' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    const dialog = await screen.findByRole('alertdialog');
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete account'
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const input = dialog.querySelector('input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'me@example.com' } });
    expect(confirm.disabled).toBe(false);
    await fireEvent.click(confirm);

    await waitFor(() => expect(deleteCurrentUser).toHaveBeenCalledWith({ password: 'secret-pw' }));
    await waitFor(() => expect(goto).toHaveBeenCalledWith('/login'));
    expect(toast.success).toHaveBeenCalledWith('Account deleted');
  });
});
