export const RECEIVER_ADAPTER_TYPES = ['github', 'uptime', 'odoo', 'generic'] as const;
export type ReceiverAdapterType = (typeof RECEIVER_ADAPTER_TYPES)[number];
