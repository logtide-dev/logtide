import { writable, get } from 'svelte/store';
import type { WebhookDelivery, WebhookDeliveryStatus } from '@logtide/shared';
import {
  listWebhookDeliveries,
  replayWebhookDelivery,
} from '$lib/api/webhook-deliveries';

export const DELIVERIES_PAGE_SIZE = 50;

export interface WebhookDeliveriesState {
  deliveries: WebhookDelivery[];
  loading: boolean;
  error: string | null;
  statusFilter: WebhookDeliveryStatus | '';
  /** 1-based page number. */
  page: number;
  pageSize: number;
  /** True when at least one more row exists after the current page. */
  hasMore: boolean;
}

const initialState: WebhookDeliveriesState = {
  deliveries: [],
  loading: false,
  error: null,
  statusFilter: '',
  page: 1,
  pageSize: DELIVERIES_PAGE_SIZE,
  hasMore: false,
};

function createWebhookDeliveriesStore() {
  const store = writable<WebhookDeliveriesState>(initialState);
  const { subscribe, update } = store;

  // Asks for one extra row so "has another page" is known without a count call.
  async function fetchPage(
    organizationId: string,
    status: WebhookDeliveryStatus | undefined,
    page: number,
    pageSize: number
  ) {
    const rows = await listWebhookDeliveries({
      organizationId,
      status,
      limit: pageSize + 1,
      offset: (page - 1) * pageSize,
    });
    return { deliveries: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
  }

  return {
    subscribe,

    async load(organizationId: string, status?: WebhookDeliveryStatus, page = 1) {
      const pageSize = get(store).pageSize;
      update((s) => ({ ...s, loading: true, error: null, statusFilter: status ?? '', page }));

      try {
        const result = await fetchPage(organizationId, status, page, pageSize);
        update((s) => ({ ...s, ...result, loading: false }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load deliveries';
        update((s) => ({ ...s, deliveries: [], hasMore: false, loading: false, error: errorMessage }));
      }
    },

    async setPage(organizationId: string, page: number) {
      const status = get(store).statusFilter || undefined;
      await this.load(organizationId, status, Math.max(1, page));
    },

    async replay(organizationId: string, id: string) {
      try {
        await replayWebhookDelivery(id);
        const { statusFilter, page, pageSize } = get(store);
        const result = await fetchPage(organizationId, statusFilter || undefined, page, pageSize);
        update((s) => ({ ...s, ...result }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to replay delivery';
        update((s) => ({ ...s, error: errorMessage }));
        throw error;
      }
    },
  };
}

export const webhookDeliveriesStore = createWebhookDeliveriesStore();
