import { writable, derived } from 'svelte/store';
import {
  notificationChannelsAPI,
  type NotificationChannel,
  type CreateNotificationChannelInput,
  type UpdateNotificationChannelInput,
  type NotificationEventType,
  type RoutingOverride,
  type TestUnsavedInput,
} from '$lib/api/notification-channels';

// ============================================================================
// TYPES
// ============================================================================

export interface NotificationChannelsState {
  channels: NotificationChannel[];
  loading: boolean;
  error: string | null;
  defaults: Record<NotificationEventType, NotificationChannel[]>;
  defaultsLoading: boolean;
  overrides: RoutingOverride[];
  overridesLoading: boolean;
}

const initialState: NotificationChannelsState = {
  channels: [],
  loading: false,
  error: null,
  defaults: {
    alert: [],
    sigma: [],
    incident: [],
    error: [],
    monitoring: [],
    project_health: [],
  },
  defaultsLoading: false,
  overrides: [],
  overridesLoading: false,
};

// ============================================================================
// STORE
// ============================================================================

function createNotificationChannelsStore() {
  const { subscribe, set, update } = writable<NotificationChannelsState>(initialState);

  return {
    subscribe,

    /**
     * Load all channels for an organization
     */
    async load(organizationId: string, enabledOnly = false) {
      update((s) => ({ ...s, loading: true, error: null }));

      try {
        const channels = await notificationChannelsAPI.list(organizationId, { enabledOnly });
        update((s) => ({ ...s, channels, loading: false }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load destinations';
        update((s) => ({ ...s, channels: [], loading: false, error: errorMessage }));
      }
    },

    /**
     * Create a new channel
     */
    async create(organizationId: string, input: CreateNotificationChannelInput): Promise<NotificationChannel> {
      const channel = await notificationChannelsAPI.create(organizationId, input);
      update((s) => ({ ...s, channels: [...s.channels, channel] }));
      return channel;
    },

    /**
     * Update a channel
     */
    async update(
      id: string,
      organizationId: string,
      input: UpdateNotificationChannelInput
    ): Promise<NotificationChannel> {
      const channel = await notificationChannelsAPI.update(id, organizationId, input);
      update((s) => ({
        ...s,
        channels: s.channels.map((c) => (c.id === id ? channel : c)),
      }));
      return channel;
    },

    /**
     * Delete a channel
     */
    async delete(id: string, organizationId: string): Promise<void> {
      await notificationChannelsAPI.delete(id, organizationId);
      update((s) => ({
        ...s,
        channels: s.channels.filter((c) => c.id !== id),
      }));
    },

    /**
     * Test a channel
     */
    async test(id: string, organizationId: string) {
      return notificationChannelsAPI.test(id, organizationId);
    },

    /**
     * Test a destination before it is saved
     */
    async testUnsaved(input: TestUnsavedInput) {
      return notificationChannelsAPI.testUnsaved(input);
    },

    /**
     * Load the rules that override the default routing
     */
    async loadOverrides(organizationId: string) {
      update((s) => ({ ...s, overridesLoading: true }));

      try {
        const overrides = await notificationChannelsAPI.getOverrides(organizationId);
        update((s) => ({ ...s, overrides, overridesLoading: false }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load overrides';
        update((s) => ({ ...s, overrides: [], overridesLoading: false, error: errorMessage }));
      }
    },

    /**
     * Load organization defaults
     */
    async loadDefaults(organizationId: string) {
      update((s) => ({ ...s, defaultsLoading: true }));

      try {
        const defaults = await notificationChannelsAPI.getDefaults(organizationId);
        update((s) => ({ ...s, defaults, defaultsLoading: false, error: null }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load defaults';
        update((s) => ({ ...s, defaultsLoading: false, error: errorMessage }));
      }
    },

    /**
     * Set default channels for an event type
     */
    async setDefaults(
      organizationId: string,
      eventType: NotificationEventType,
      channelIds: string[]
    ): Promise<void> {
      await notificationChannelsAPI.setDefaults(organizationId, eventType, channelIds);

      // Refresh defaults
      const defaults = await notificationChannelsAPI.getDefaults(organizationId);
      update((s) => ({ ...s, defaults }));
    },

    /**
     * Reset store
     */
    reset() {
      set(initialState);
    },
  };
}

export const notificationChannelsStore = createNotificationChannelsStore();

// ============================================================================
// DERIVED STORES
// ============================================================================

/**
 * Only email channels
 */
export const emailChannels = derived(notificationChannelsStore, ($store) =>
  $store.channels.filter((c) => c.type === 'email')
);

/**
 * Only webhook channels
 */
export const webhookChannels = derived(notificationChannelsStore, ($store) =>
  $store.channels.filter((c) => c.type === 'webhook')
);

/**
 * Only enabled channels
 */
export const enabledChannels = derived(notificationChannelsStore, ($store) =>
  $store.channels.filter((c) => c.enabled)
);
