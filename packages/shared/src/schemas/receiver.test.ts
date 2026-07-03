import { describe, it, expect } from 'vitest';
import { receiverFieldMappingSchema, RECEIVER_ADAPTER_TYPES } from '../index.js';

describe('receiverFieldMappingSchema', () => {
  it('accepts a full valid mapping', () => {
    const result = receiverFieldMappingSchema.safeParse({
      message: 'msg.text',
      level: 'severity',
      service: 'source.app',
      timestamp: 'ts',
      levelMap: { crit: 'critical', warning: 'warn' },
      defaults: { level: 'info', service: 'external' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty mapping', () => {
    expect(receiverFieldMappingSchema.safeParse({}).success).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(receiverFieldMappingSchema.safeParse({ nope: 'x' }).success).toBe(false);
  });

  it('rejects invalid levels in levelMap and defaults', () => {
    expect(receiverFieldMappingSchema.safeParse({ levelMap: { a: 'verbose' } }).success).toBe(false);
    expect(receiverFieldMappingSchema.safeParse({ defaults: { level: 'verbose' } }).success).toBe(false);
  });

  it('exposes the adapter type list', () => {
    expect(RECEIVER_ADAPTER_TYPES).toEqual(['github', 'uptime', 'generic']);
  });
});
