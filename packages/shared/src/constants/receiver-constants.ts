export const RECEIVER_ADAPTER_TYPES = ['github', 'uptime', 'generic'] as const;
export type ReceiverAdapterType = (typeof RECEIVER_ADAPTER_TYPES)[number];
