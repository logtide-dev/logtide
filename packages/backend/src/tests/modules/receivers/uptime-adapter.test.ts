import { describe, it, expect } from 'vitest';
import { uptimeAdapter } from '../../../modules/receivers/adapters/uptime.js';
import type { AdapterReceiverInfo } from '../../../modules/receivers/adapters/types.js';

const receiver: AdapterReceiverInfo = {
  id: 'r-1',
  name: 'uptime',
  adapterType: 'uptime',
  fieldMapping: null,
};

describe('uptimeAdapter - Uptime Robot', () => {
  it('maps a down alert (alertType 1) to error', () => {
    const result = uptimeAdapter(
      {
        monitorID: '777',
        monitorFriendlyName: 'API prod',
        monitorURL: 'https://api.example.com',
        alertType: '1',
        alertTypeFriendlyName: 'Down',
        alertDetails: 'Connection Timeout',
      },
      receiver
    );
    if (result.kind !== 'logs') throw new Error('expected logs');
    const log = result.logs[0];
    expect(log.level).toBe('error');
    expect(log.service).toBe('API prod');
    expect(log.message).toBe('Monitor API prod is DOWN: Connection Timeout');
    expect((log.metadata as any).monitor_url).toBe('https://api.example.com');
  });

  it('maps an up alert (alertType 2) to info and ssl expiry (3) to warn', () => {
    const up = uptimeAdapter(
      { monitorFriendlyName: 'API prod', alertType: 2, alertTypeFriendlyName: 'Up' },
      receiver
    );
    const ssl = uptimeAdapter(
      { monitorFriendlyName: 'API prod', alertType: 3, alertTypeFriendlyName: 'SSL expiry' },
      receiver
    );
    if (up.kind !== 'logs' || ssl.kind !== 'logs') throw new Error('expected logs');
    expect(up.logs[0].level).toBe('info');
    expect(up.logs[0].message).toBe('Monitor API prod is UP');
    expect(ssl.logs[0].level).toBe('warn');
  });
});

describe('uptimeAdapter - Better Stack', () => {
  it('maps a started incident to error', () => {
    const result = uptimeAdapter(
      {
        data: {
          id: 'inc-1',
          type: 'incident',
          attributes: {
            name: 'API prod',
            cause: 'Status 500',
            status: 'Started',
            started_at: '2026-07-01T10:00:00Z',
            url: 'https://api.example.com',
          },
        },
      },
      receiver
    );
    if (result.kind !== 'logs') throw new Error('expected logs');
    expect(result.logs[0].level).toBe('error');
    expect(result.logs[0].service).toBe('API prod');
    expect(result.logs[0].message).toBe('Incident started: Status 500');
  });

  it('maps a resolved incident to info', () => {
    const result = uptimeAdapter(
      {
        data: {
          type: 'incident',
          attributes: { name: 'API prod', cause: 'Status 500', status: 'Resolved' },
        },
      },
      receiver
    );
    if (result.kind !== 'logs') throw new Error('expected logs');
    expect(result.logs[0].level).toBe('info');
    expect(result.logs[0].message).toBe('Incident resolved: Status 500');
  });
});

describe('uptimeAdapter - unknown shapes', () => {
  it('skips unrecognized payloads', () => {
    expect(uptimeAdapter({ hello: 'world' }, receiver).kind).toBe('skipped');
  });
});
