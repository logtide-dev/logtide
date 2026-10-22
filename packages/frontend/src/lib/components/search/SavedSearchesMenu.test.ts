import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('$lib/api/saved-searches', () => ({ savedSearchesAPI: api }));

import SavedSearchesMenu from './SavedSearchesMenu.svelte';
import { toastStore } from '$lib/stores/toast';
import type { SavedSearch, SavedSearchState } from '$lib/api/saved-searches';

const CURRENT: SavedSearchState = {
  q: 'level:error service:api',
  projectIds: ['p1'],
  range: '24h',
  view: 'table',
  columns: ['user.id'],
};

function saved(overrides: Partial<SavedSearch>): SavedSearch {
  return {
    id: 's1',
    organizationId: 'org-1',
    createdBy: 'u1',
    createdByName: 'Ada',
    name: 'Errors',
    visibility: 'organization',
    state: { q: 'level:error', projectIds: [] },
    canEdit: true,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

const MINE = saved({});
const MINE_PRIVATE = saved({ id: 's2', name: 'Slow requests', visibility: 'private' });
const THEIRS = saved({ id: 's3', name: 'Payments', createdBy: 'u2', createdByName: 'Grace', canEdit: false });
const THEIRS_EDITABLE = saved({ id: 's4', name: 'Auth failures', createdBy: 'u2', createdByName: 'Linus', canEdit: true });
const ORPHAN = saved({ id: 's5', name: 'Old search', createdBy: null, createdByName: null, canEdit: false });
const ALL = [MINE, MINE_PRIVATE, THEIRS, THEIRS_EDITABLE, ORPHAN];

function setup(props: Partial<{ openSavedId: string | null; currentUserId: string | null }> = {}) {
  const onOpen = vi.fn();
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  const utils = render(SavedSearchesMenu, {
    props: {
      organizationId: 'org-1',
      currentUserId: props.currentUserId === undefined ? 'u1' : props.currentUserId,
      currentState: CURRENT,
      openSavedId: props.openSavedId ?? null,
      onOpen,
      onSaved,
      onDeleted,
    },
  });
  return { ...utils, onOpen, onSaved, onDeleted };
}

async function openMenu() {
  await fireEvent.click(screen.getByRole('button', { name: 'Saved searches' }));
  await tick();
  await screen.findByRole('region', { name: 'Your searches' });
}

let successSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  api.list.mockReset().mockResolvedValue(ALL);
  api.create.mockReset();
  api.update.mockReset();
  api.remove.mockReset();
  successSpy = vi.spyOn(toastStore, 'success').mockImplementation(() => {});
  errorSpy = vi.spyOn(toastStore, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SavedSearchesMenu', () => {
  it('loads on first open only', async () => {
    setup();
    expect(api.list).not.toHaveBeenCalled();
    await openMenu();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledWith('org-1');
    await fireEvent.click(screen.getByRole('button', { name: 'Saved searches' }));
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Saved searches' }));
    await tick();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('groups private and organization searches', async () => {
    setup();
    await openMenu();
    const mine = screen.getByRole('region', { name: 'Your searches' });
    const org = screen.getByRole('region', { name: 'Organization' });
    expect(within(mine).getByRole('heading', { name: 'Your searches' })).toBeInTheDocument();
    expect(within(org).getByRole('heading', { name: 'Organization' })).toBeInTheDocument();
    expect(within(mine).getByRole('button', { name: /^Errors/ })).toBeInTheDocument();
    expect(within(mine).getByRole('button', { name: /^Slow requests/ })).toBeInTheDocument();
    expect(within(mine).queryByRole('button', { name: /^Payments/ })).toBeNull();
    expect(within(org).getByRole('button', { name: /^Payments/ })).toBeInTheDocument();
    expect(within(org).getByRole('button', { name: /^Auth failures/ })).toBeInTheDocument();
    expect(within(org).getByRole('button', { name: /^Old search/ })).toBeInTheDocument();
    // own searches shared with the organization say so
    expect(within(mine).getByRole('button', { name: /^Errors/ })).toHaveTextContent('Shared');
    expect(within(mine).getByRole('button', { name: /^Slow requests/ })).not.toHaveTextContent('Shared');
  });

  it('shows everything under Organization without a current user', async () => {
    setup({ currentUserId: null });
    await fireEvent.click(screen.getByRole('button', { name: 'Saved searches' }));
    await tick();
    const org = await screen.findByRole('region', { name: 'Organization' });
    expect(within(org).getAllByRole('button', { name: /^(Errors|Slow requests|Payments|Auth failures|Old search)/ })).toHaveLength(5);
    expect(screen.queryByRole('region', { name: 'Your searches' })).toBeNull();
  });

  it('shows an empty state', async () => {
    api.list.mockResolvedValue([]);
    setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Saved searches' }));
    await tick();
    expect(await screen.findByText('No saved searches yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save search' })).toBeInTheDocument();
  });

  it('shows a load error with Retry', async () => {
    api.list.mockRejectedValueOnce(new Error('boom'));
    setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Saved searches' }));
    await tick();
    expect(await screen.findByText('Could not load saved searches')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Your searches' })).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('opens a search', async () => {
    const { onOpen } = setup();
    await openMenu();
    await fireEvent.click(screen.getByRole('button', { name: /^Payments/ }));
    expect(onOpen).toHaveBeenCalledWith(THEIRS);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Your searches' })).toBeNull());
  });

  it('marks the open search', async () => {
    setup({ openSavedId: 's2' });
    await openMenu();
    expect(screen.getByRole('button', { name: /^Slow requests/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /^Errors/ })).not.toHaveAttribute('aria-current');
  });

  it('saves the current state with name and visibility', async () => {
    const created = saved({ id: 's9', name: 'API errors', state: CURRENT });
    api.create.mockResolvedValue(created);
    const { onSaved } = setup();
    await openMenu();
    await fireEvent.click(screen.getByRole('button', { name: 'Save search' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Save search' })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /^Private/ })).toBeChecked();
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    const name = within(dialog).getByLabelText('Name');
    expect(name).toHaveAttribute('maxlength', '100');
    await fireEvent.input(name, { target: { value: '  API errors  ' } });
    await fireEvent.click(within(dialog).getByRole('radio', { name: /^Organization/ }));
    expect(save).toBeEnabled();
    await fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(api.create).toHaveBeenCalledWith('org-1', {
      name: 'API errors',
      visibility: 'organization',
      state: CURRENT,
    });
    expect(successSpy).toHaveBeenCalledWith('Search saved');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('defaults the visibility to private', async () => {
    api.create.mockResolvedValue(saved({ id: 's9', visibility: 'private' }));
    setup();
    await openMenu();
    await fireEvent.click(screen.getByRole('button', { name: 'Save search' }));
    const dialog = await screen.findByRole('dialog');
    await fireEvent.input(within(dialog).getByLabelText('Name'), { target: { value: 'Mine' } });
    await fireEvent.submit(within(dialog).getByLabelText('Name').closest('form')!);
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][1]).toMatchObject({ name: 'Mine', visibility: 'private' });
  });

  it('updates the open search with the current state', async () => {
    const updated = saved({ state: CURRENT });
    api.update.mockResolvedValue(updated);
    const { onSaved } = setup({ openSavedId: 's1' });
    await openMenu();
    await fireEvent.click(screen.getByRole('button', { name: 'Update "Errors"' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('s1', 'org-1', { state: CURRENT }));
    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Search updated'));
    expect(onSaved).toHaveBeenCalledWith(updated);
  });

  it('offers no update without an open search', async () => {
    setup();
    await openMenu();
    expect(screen.queryByRole('button', { name: /^Update/ })).toBeNull();
  });

  it('renames', async () => {
    api.update.mockResolvedValue(saved({ name: 'New', visibility: 'private' }));
    const { onSaved } = setup();
    await openMenu();
    await fireEvent.click(screen.getByRole('button', { name: 'Rename Errors' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Rename saved search' })).toBeInTheDocument();
    const name = within(dialog).getByLabelText('Name') as HTMLInputElement;
    expect(name.value).toBe('Errors');
    expect(within(dialog).getByRole('radio', { name: /^Organization/ })).toBeChecked();
    await fireEvent.input(name, { target: { value: 'New' } });
    await fireEvent.click(within(dialog).getByRole('radio', { name: /^Private/ }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith('s1', 'org-1', { name: 'New', visibility: 'private' }),
    );
    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Search renamed'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('deletes after confirmation', async () => {
    api.remove.mockResolvedValue(undefined);
    const { onDeleted } = setup({ openSavedId: 's1' });
    await openMenu();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Errors' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Delete saved search')).toBeInTheDocument();
    expect(
      within(confirm).getByText('"Errors" will be removed for everyone who can see it.'),
    ).toBeInTheDocument();
    expect(api.remove).not.toHaveBeenCalled();
    await fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('s1', 'org-1'));
    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Search deleted'));
    expect(onDeleted).toHaveBeenCalledWith('s1');
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('cancelling the confirmation deletes nothing', async () => {
    setup();
    await openMenu();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Errors' }));
    const confirm = await screen.findByRole('alertdialog');
    await fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('shows edit actions from canEdit and the visibility switch only for the creator', async () => {
    api.update.mockResolvedValue(saved({ id: 's4', name: 'Auth', createdBy: 'u2' }));
    setup({ openSavedId: 's3' });
    await openMenu();
    // not editable: no Rename, Delete or Update
    expect(screen.queryByRole('button', { name: 'Rename Payments' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Payments' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Update/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename Old search' })).toBeNull();
    // creator names on organization searches
    const org = screen.getByRole('region', { name: 'Organization' });
    expect(within(org).getByRole('button', { name: /^Payments/ })).toHaveTextContent('Grace');
    expect(within(org).getByRole('button', { name: /^Auth failures/ })).toHaveTextContent('Linus');
    // an admin can edit someone else's organization search, without the visibility control
    expect(screen.getByRole('button', { name: 'Delete Auth failures' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Rename Auth failures' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('radio')).toBeNull();
    expect(within(dialog).queryByText('Visibility')).toBeNull();
    await fireEvent.input(within(dialog).getByLabelText('Name'), { target: { value: 'Auth' } });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith('s4', 'org-1', { name: 'Auth' });
    expect(Object.keys(api.update.mock.calls[0][2])).toEqual(['name']);
  });

  it('offers Update on an editable open search of someone else', async () => {
    setup({ openSavedId: 's4' });
    await openMenu();
    expect(screen.getByRole('button', { name: 'Update "Auth failures"' })).toBeInTheDocument();
  });

  it('shows the server error on failure', async () => {
    api.create.mockRejectedValue(new Error('Saved search limit reached'));
    const { onSaved } = setup();
    await openMenu();
    await fireEvent.click(screen.getByRole('button', { name: 'Save search' }));
    const dialog = await screen.findByRole('dialog');
    await fireEvent.input(within(dialog).getByLabelText('Name'), { target: { value: 'One more' } });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Saved search limit reached'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(successSpy).not.toHaveBeenCalled();
    // the dialog stays open so the user can retry
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('toasts update, rename and delete failures', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.update.mockRejectedValue(new Error('Saved search not found'));
    api.remove.mockRejectedValue(new Error('Forbidden'));
    setup({ openSavedId: 's1' });
    await openMenu();
    await fireEvent.click(screen.getByRole('button', { name: 'Update "Errors"' }));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Saved search not found'));

    await openMenu();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Errors' }));
    const confirm = await screen.findByRole('alertdialog');
    await fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Forbidden'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('reloads for another organization', async () => {
    const utils = setup();
    await openMenu();
    await fireEvent.click(screen.getByRole('button', { name: 'Saved searches' }));
    await tick();
    await utils.rerender({ organizationId: 'org-2' });
    await openMenu();
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.list).toHaveBeenLastCalledWith('org-2');
  });
});
