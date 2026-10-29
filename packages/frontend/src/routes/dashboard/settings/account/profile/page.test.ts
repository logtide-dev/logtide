import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { updateCurrentUser, toast } = vi.hoisted(() => ({
  updateCurrentUser: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/users', () => ({
  UsersAPI: class {
    updateCurrentUser = updateCurrentUser;
  },
}));
vi.mock('$lib/stores/toast', () => ({ toastStore: toast }));

import Page from './+page.svelte';
import { authStore } from '$lib/stores/auth';

describe('profile page', () => {
  beforeEach(() => {
    localStorage.clear();
    updateCurrentUser.mockReset();
    toast.success.mockReset();
    authStore.setAuth({ id: 'u1', email: 'me@example.com', name: 'Me' } as never, 'tok');
  });

  it('prefills and saves name and email', async () => {
    updateCurrentUser.mockResolvedValue({ user: { id: 'u1', email: 'new@example.com', name: 'New Name' } });
    render(Page);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Me');
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'New Name' } });
    await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateCurrentUser).toHaveBeenCalledWith({ name: 'New Name', email: 'new@example.com' }));
    expect(toast.success).toHaveBeenCalledWith('Profile updated');
  });

  it('shows the Profile header scoped to you', () => {
    render(Page);
    expect(screen.getByRole('heading', { name: 'Profile', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Applies to: You')).toBeInTheDocument();
  });
});
