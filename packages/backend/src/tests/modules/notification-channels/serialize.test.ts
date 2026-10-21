import { describe, it, expect } from 'vitest';
import type { NotificationChannel, ChannelConfig } from '@logtide/shared';
import {
  SECRET_MASK,
  serializeChannel,
  mergeConfigSecrets,
} from '../../../modules/notification-channels/serialize.js';

function channel(type: NotificationChannel['type'], config: unknown): NotificationChannel {
  return {
    id: 'c1',
    organizationId: 'o1',
    name: 'n',
    type,
    enabled: true,
    config: config as ChannelConfig,
    description: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('serializeChannel', () => {
  it('drops bearer token and flags hasSecret', () => {
    const out = serializeChannel(
      channel('webhook', { url: 'https://x.example/h', auth: { type: 'bearer', token: 'tok-123' } }),
      { isAdmin: true }
    );
    const auth = (out.config as any).auth;
    expect(auth.token).toBeUndefined();
    expect(auth.hasSecret).toBe(true);
    expect(auth.type).toBe('bearer');
    expect(JSON.stringify(out)).not.toContain('tok-123');
  });

  it('drops basic password but keeps username', () => {
    const out = serializeChannel(
      channel('webhook', {
        url: 'https://x.example/h',
        auth: { type: 'basic', username: 'bob', password: 'pw-999' },
      }),
      { isAdmin: true }
    );
    const auth = (out.config as any).auth;
    expect(auth.password).toBeUndefined();
    expect(auth.username).toBe('bob');
    expect(auth.hasSecret).toBe(true);
    expect(JSON.stringify(out)).not.toContain('pw-999');
  });

  it('masks secret-like header values for admins and keeps the others', () => {
    const out = serializeChannel(
      channel('webhook', {
        url: 'https://x.example/h',
        headers: { Authorization: 'Bearer abc', 'X-Api-Key': 'k', 'X-Team': 'blue' },
      }),
      { isAdmin: true }
    );
    const headers = (out.config as any).headers;
    expect(headers.Authorization).toBe(SECRET_MASK);
    expect(headers['X-Api-Key']).toBe(SECRET_MASK);
    expect(headers['X-Team']).toBe('blue');
  });

  it('masks the pagerduty routing key even for admins', () => {
    const out = serializeChannel(channel('pagerduty', { routingKey: 'a'.repeat(32) }), {
      isAdmin: true,
    });
    expect((out.config as any).routingKey).toBe(SECRET_MASK);
  });

  it('reduces webhook url to host and masks all headers for non admins', () => {
    const out = serializeChannel(
      channel('webhook', {
        url: 'https://hooks.slack.com/services/T1/B2/secrettoken',
        headers: { 'X-Team': 'blue' },
      }),
      { isAdmin: false }
    );
    expect((out.config as any).url).toBe('https://hooks.slack.com/...');
    expect((out.config as any).headers['X-Team']).toBe(SECRET_MASK);
    expect(JSON.stringify(out)).not.toContain('secrettoken');
  });

  it('leaves email channels alone', () => {
    const cfg = { recipients: ['a@x.com'] };
    expect(serializeChannel(channel('email', cfg), { isAdmin: false }).config).toEqual(cfg);
  });
});

describe('mergeConfigSecrets', () => {
  const stored = {
    url: 'https://x.example/h',
    auth: { type: 'bearer', token: 'stored-token' },
    headers: { 'X-Api-Key': 'stored-key' },
  } as unknown as ChannelConfig;

  it('keeps the stored token when incoming has none', () => {
    const out = mergeConfigSecrets(stored, {
      url: 'https://x.example/h2',
      auth: { type: 'bearer' },
    } as ChannelConfig) as any;
    expect(out.url).toBe('https://x.example/h2');
    expect(out.auth.token).toBe('stored-token');
  });

  it('replaces the token when incoming has one', () => {
    const out = mergeConfigSecrets(stored, {
      url: 'https://x.example/h',
      auth: { type: 'bearer', token: 'new' },
    } as ChannelConfig) as any;
    expect(out.auth.token).toBe('new');
  });

  it('does not carry a stored secret over to a different auth type', () => {
    const out = mergeConfigSecrets(stored, {
      url: 'https://x.example/h',
      auth: { type: 'basic', username: 'u' },
    } as ChannelConfig) as any;
    expect(out.auth.token).toBeUndefined();
    expect(out.auth.password).toBeUndefined();
  });

  it('restores masked header values from the stored config', () => {
    const out = mergeConfigSecrets(stored, {
      url: 'https://x.example/h',
      headers: { 'X-Api-Key': SECRET_MASK, 'X-New': SECRET_MASK, 'X-Team': 'blue' },
    } as ChannelConfig) as any;
    expect(out.headers['X-Api-Key']).toBe('stored-key');
    expect(out.headers['X-New']).toBeUndefined();
    expect(out.headers['X-Team']).toBe('blue');
  });

  it('keeps the stored routing key when incoming is the mask or empty', () => {
    const existing = { routingKey: 'a'.repeat(32) } as ChannelConfig;
    expect((mergeConfigSecrets(existing, { routingKey: SECRET_MASK } as ChannelConfig) as any).routingKey).toBe(
      'a'.repeat(32)
    );
    expect((mergeConfigSecrets(existing, {} as ChannelConfig) as any).routingKey).toBe('a'.repeat(32));
    expect((mergeConfigSecrets(existing, { routingKey: 'b'.repeat(32) } as ChannelConfig) as any).routingKey).toBe(
      'b'.repeat(32)
    );
  });
});
