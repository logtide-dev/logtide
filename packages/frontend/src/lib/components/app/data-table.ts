import type { Snippet } from 'svelte';

export type DataTableColumn<T> = {
  key: string;
  header: string;
  sortable?: boolean;
  class?: string;
  cell: Snippet<[T]>;
};

export type DataTableSort = { key: string; dir: 'asc' | 'desc' };
