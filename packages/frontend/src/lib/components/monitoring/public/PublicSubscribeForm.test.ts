import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const api = vi.hoisted(() => ({
  subscribeToStatusPage: vi.fn(),
  confirmStatusSubscription: vi.fn(),
  unsubscribeFromStatusPage: vi.fn(),
}));

vi.mock('$lib/api/status-page', () => api);

import PublicSubscribeForm from './PublicSubscribeForm.svelte';
import SubscriptionAction from './SubscriptionAction.svelte';

beforeEach(() => {
  api.subscribeToStatusPage.mockReset().mockResolvedValue({ ok: true });
  api.confirmStatusSubscription.mockReset().mockResolvedValue({ ok: true });
  api.unsubscribeFromStatusPage.mockReset().mockResolvedValue({ ok: true });
});

describe('PublicSubscribeForm', () => {
  it('posts the email and shows "Check your inbox to confirm"', async () => {
    render(PublicSubscribeForm, { props: { orgSlug: 'acme', projectSlug: 'shop' } });
    await fireEvent.input(screen.getByLabelText('Email address'), { target: { value: ' Me@Example.com ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    await waitFor(() => expect(api.subscribeToStatusPage).toHaveBeenCalledWith('acme', 'shop', 'Me@Example.com'));
    expect(await screen.findByText('Check your inbox to confirm')).toBeInTheDocument();
  });

  it('blocks an empty or malformed address without calling the API', async () => {
    render(PublicSubscribeForm, { props: { orgSlug: 'acme', projectSlug: 'shop' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(api.subscribeToStatusPage).not.toHaveBeenCalled();
  });

  it('shows a friendly message on 429', async () => {
    api.subscribeToStatusPage.mockRejectedValue(Object.assign(new Error('Too Many Requests'), { status: 429 }));
    render(PublicSubscribeForm, { props: { orgSlug: 'acme', projectSlug: 'shop' } });
    await fireEvent.input(screen.getByLabelText('Email address'), { target: { value: 'me@example.com' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    expect(await screen.findByText('Too many attempts. Try again in a minute.')).toBeInTheDocument();
  });

  it('shows the server message for other failures', async () => {
    api.subscribeToStatusPage.mockRejectedValue(new Error('Invalid email'));
    render(PublicSubscribeForm, { props: { orgSlug: 'acme', projectSlug: 'shop' } });
    await fireEvent.input(screen.getByLabelText('Email address'), { target: { value: 'me@example.com' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    expect(await screen.findByText('Invalid email')).toBeInTheDocument();
  });
});

describe('SubscriptionAction', () => {
  it('confirm posts the token and shows success', async () => {
    render(SubscriptionAction, { props: { orgSlug: 'acme', projectSlug: 'shop', token: 'abc', action: 'confirm' } });
    await waitFor(() => expect(api.confirmStatusSubscription).toHaveBeenCalledWith('acme', 'shop', 'abc'));
    expect(await screen.findByText('Subscription confirmed')).toBeInTheDocument();
  });

  it('confirm shows "This link is invalid or has expired" on failure', async () => {
    api.confirmStatusSubscription.mockRejectedValue(new Error('Invalid or expired link'));
    render(SubscriptionAction, { props: { orgSlug: 'acme', projectSlug: 'shop', token: 'bad', action: 'confirm' } });
    expect(await screen.findByText('This link is invalid or has expired')).toBeInTheDocument();
  });

  it('unsubscribe behaves the same', async () => {
    render(SubscriptionAction, { props: { orgSlug: 'acme', projectSlug: 'shop', token: 'abc', action: 'unsubscribe' } });
    await waitFor(() => expect(api.unsubscribeFromStatusPage).toHaveBeenCalledWith('acme', 'shop', 'abc'));
    expect(await screen.findByText('You are unsubscribed')).toBeInTheDocument();

    api.unsubscribeFromStatusPage.mockRejectedValue(new Error('Invalid or expired link'));
    render(SubscriptionAction, { props: { orgSlug: 'acme', projectSlug: 'shop', token: 'bad', action: 'unsubscribe' } });
    expect(await screen.findByText('This link is invalid or has expired')).toBeInTheDocument();
  });

  it('a missing token is reported without calling the API', async () => {
    render(SubscriptionAction, { props: { orgSlug: 'acme', projectSlug: 'shop', token: '', action: 'confirm' } });
    expect(await screen.findByText('This link is invalid or has expired')).toBeInTheDocument();
    expect(api.confirmStatusSubscription).not.toHaveBeenCalled();
  });
});
