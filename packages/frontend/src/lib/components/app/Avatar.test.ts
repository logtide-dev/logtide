import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Avatar from './Avatar.svelte';

describe('Avatar', () => {
  it('uses the first letters of the first two words', () => {
    render(Avatar, { name: 'Ada Lovelace' });
    expect(screen.getByRole('img', { name: 'Ada Lovelace' }).textContent?.trim()).toBe('AL');
  });

  it('uses one letter for a single word', () => {
    render(Avatar, { name: 'madonna' });
    expect(screen.getByRole('img').textContent?.trim()).toBe('M');
  });

  it('falls back to the email local part', () => {
    render(Avatar, { name: '', email: 'bob@x.io' });
    expect(screen.getByRole('img').textContent?.trim()).toBe('B');
  });

  it('falls back to a question mark', () => {
    render(Avatar, { name: '' });
    expect(screen.getByRole('img').textContent?.trim()).toBe('?');
  });

  it('is stable for the same input', () => {
    const a = render(Avatar, { name: 'Ada Lovelace', email: 'ada@x.io' });
    const first = screen.getByRole('img').className;
    a.unmount();
    render(Avatar, { name: 'Ada Lovelace', email: 'ada@x.io' });
    expect(screen.getByRole('img').className).toBe(first);
  });

  it('applies the size classes', () => {
    render(Avatar, { name: 'Ada', size: 'sm' });
    expect(screen.getByRole('img').className).toContain('size-6');
  });
});
