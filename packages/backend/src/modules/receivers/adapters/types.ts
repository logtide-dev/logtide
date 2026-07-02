import type { LogInput, ReceiverAdapterType, ReceiverFieldMapping } from '@logtide/shared';

export interface AdapterReceiverInfo {
  id: string;
  name: string;
  adapterType: ReceiverAdapterType;
  fieldMapping: ReceiverFieldMapping | null;
}

export type AdapterResult =
  | { kind: 'logs'; logs: LogInput[] }
  | { kind: 'skipped'; reason: string };

/**
 * A receiver adapter is a pure function turning a raw external payload into
 * zero or more log entries. New adapters plug in via adapters/index.ts and
 * need no changes to the receiver core.
 */
export type ReceiverAdapter = (
  payload: Record<string, unknown>,
  receiver: AdapterReceiverInfo
) => AdapterResult;
