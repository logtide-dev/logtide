import type { ReceiverAdapterType } from '@logtide/shared';
import type { ReceiverAdapter } from './types.js';
import { genericAdapter } from './generic.js';
import { githubAdapter } from './github.js';
import { uptimeAdapter } from './uptime.js';
import { odooAdapter } from './odoo.js';

const ADAPTERS: Record<ReceiverAdapterType, ReceiverAdapter> = {
  generic: genericAdapter,
  github: githubAdapter,
  uptime: uptimeAdapter,
  odoo: odooAdapter,
};

export function getAdapter(type: ReceiverAdapterType): ReceiverAdapter {
  const adapter = ADAPTERS[type];
  if (!adapter) throw new Error(`No adapter registered for type "${type}"`);
  return adapter;
}

export type { AdapterReceiverInfo, AdapterResult, ReceiverAdapter } from './types.js';
