import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Pagination from './Pagination.svelte';

describe('Pagination', () => {
  it('shows the range on the first page', () => {
    render(Pagination, { page: 1, pageSize: 50, total: 1234, onPageChange: vi.fn() });
    expect(screen.getByText('1 to 50 of 1,234')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 25')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });

  it('clamps the range on the last page and disables Next', () => {
    render(Pagination, { page: 25, pageSize: 50, total: 1234, onPageChange: vi.fn() });
    expect(screen.getByText('1,201 to 1,234 of 1,234')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
  });

  it('calls onPageChange with the next page', async () => {
    const onPageChange = vi.fn();
    render(Pagination, { page: 1, pageSize: 50, total: 1234, onPageChange });
    await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('never calls onPageChange outside the bounds', async () => {
    const onPageChange = vi.fn();
    render(Pagination, { page: 1, pageSize: 50, total: 1234, onPageChange });
    await fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('renders nothing when total is 0', () => {
    const { container } = render(Pagination, { page: 1, pageSize: 50, total: 0, onPageChange: vi.fn() });
    expect(container.textContent?.trim()).toBe('');
  });

  it('shows only the range text for a single page', () => {
    render(Pagination, { page: 1, pageSize: 50, total: 12, onPageChange: vi.fn() });
    expect(screen.getByText('1 to 12 of 12')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Page /)).toBeNull();
  });
});
