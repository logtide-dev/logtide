import { describe, it, expect } from 'vitest';
import { odooAdapter } from '../../../modules/receivers/adapters/odoo.js';
import type { AdapterReceiverInfo } from '../../../modules/receivers/adapters/types.js';

const receiver: AdapterReceiverInfo = {
  id: 'r-1',
  name: 'odoo',
  adapterType: 'odoo',
  fieldMapping: null,
};

const payload = {
  _id: 42,
  _model: 'account.move',
  _name: 'INV/2026/0042',
  _action: 'Send Webhook Notification(#12)',
  state: 'posted',
  amount_total: 120.5,
  partner_id: [7, 'Acme Srl'],
};

describe('odooAdapter', () => {
  it('maps a record update to an info log', () => {
    const result = odooAdapter(payload, receiver);
    if (result.kind !== 'logs') throw new Error('expected logs');
    const log = result.logs[0];
    expect(log.level).toBe('info');
    expect(log.service).toBe('odoo');
    expect(log.message).toBe('account.move INV/2026/0042 → posted');
    const meta = log.metadata as any;
    expect(meta.receiver.adapter).toBe('odoo');
    expect(meta.odoo.model).toBe('account.move');
    expect(meta.odoo.id).toBe(42);
    expect(meta.odoo.display_name).toBe('INV/2026/0042');
    expect(meta.odoo.action).toBe('Send Webhook Notification(#12)');
    expect(meta.odoo.fields).toEqual({
      state: 'posted',
      amount_total: 120.5,
      partner_id: [7, 'Acme Srl'],
    });
  });

  it('falls back to #id and omits the state suffix', () => {
    const result = odooAdapter({ _id: 9, _model: 'res.partner' }, receiver);
    if (result.kind !== 'logs') throw new Error('expected logs');
    expect(result.logs[0].message).toBe('res.partner #9');
  });

  it('maps failure-like states to warn', () => {
    const result = odooAdapter({ ...payload, state: 'cancel' }, receiver);
    if (result.kind !== 'logs') throw new Error('expected logs');
    expect(result.logs[0].level).toBe('warn');
  });

  it('honours levelMap against state, case-insensitively', () => {
    const result = odooAdapter(
      { ...payload, state: 'Posted' },
      { ...receiver, fieldMapping: { levelMap: { posted: 'debug', cancel: 'error' } } }
    );
    if (result.kind !== 'logs') throw new Error('expected logs');
    expect(result.logs[0].level).toBe('debug');
  });

  it('uses the configured default service and level', () => {
    const result = odooAdapter(payload, {
      ...receiver,
      fieldMapping: { defaults: { service: 'erp', level: 'warn' } },
    });
    if (result.kind !== 'logs') throw new Error('expected logs');
    expect(result.logs[0].service).toBe('erp');
    expect(result.logs[0].level).toBe('warn');
  });

  it('skips payloads without _model', () => {
    const result = odooAdapter({ _id: 1, state: 'draft' }, receiver);
    expect(result.kind).toBe('skipped');
  });
});
