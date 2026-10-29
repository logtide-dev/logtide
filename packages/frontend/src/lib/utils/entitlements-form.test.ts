import { describe, it, expect } from 'vitest';
import {
    buildEntitlementRows,
    formatEntitlementValue,
    planEntitlementSave,
    resetEntitlementRow,
    type EntitlementRow,
} from './entitlements-form';

const res = {
    entitlements: {
        'auth.sso': { kind: 'boolean' as const, enabled: true },
        'alerts.max_rules': { kind: 'limit' as const, limit: 7 },
        'ingestion.max_bytes_monthly': { kind: 'quota' as const, limit: null },
        'projects.max': { kind: 'limit' as const, limit: 5 },
    },
    defaults: {
        'auth.sso': { kind: 'boolean' as const, enabled: true },
        'alerts.max_rules': { kind: 'limit' as const, limit: null },
        'ingestion.max_bytes_monthly': { kind: 'quota' as const, limit: null },
        'projects.max': { kind: 'limit' as const, limit: 5 },
    },
    overrides: { 'alerts.max_rules': { enabled: null, limitValue: 7 } },
};

function edit(rows: EntitlementRow[], cap: string, patch: Partial<EntitlementRow>): EntitlementRow[] {
    return rows.map((r) => (r.capability === cap ? { ...r, ...patch } : r));
}

describe('buildEntitlementRows', () => {
    it('marks overrides and keeps the default for each key', () => {
        const rows = buildEntitlementRows(res);
        const rules = rows.find((r) => r.capability === 'alerts.max_rules')!;
        expect(rules).toMatchObject({ isOverride: true, limitText: '7', unlimited: false });
        expect(rules.defaultValue).toEqual({ kind: 'limit', limit: null });
        const quota = rows.find((r) => r.capability === 'ingestion.max_bytes_monthly')!;
        expect(quota).toMatchObject({ isOverride: false, unlimited: true, limitText: '' });
    });
});

describe('planEntitlementSave', () => {
    it('sends nothing when nothing changed', () => {
        const rows = buildEntitlementRows(res);
        expect(planEntitlementSave(rows, rows)).toEqual({ updates: [], resets: [], errors: [] });
    });

    it('sends only the changed keys', () => {
        const rows = buildEntitlementRows(res);
        let next = edit(rows, 'auth.sso', { enabled: false });
        next = edit(next, 'projects.max', { limitText: '10' });
        const plan = planEntitlementSave(rows, next);
        expect(plan.updates).toEqual([
            { capability: 'auth.sso', enabled: false },
            { capability: 'projects.max', limitValue: 10 },
        ]);
        expect(plan.errors).toEqual([]);
    });

    it('never turns an empty input into an unlimited override', () => {
        const rows = buildEntitlementRows(res);
        const next = edit(rows, 'projects.max', { limitText: '' });
        const plan = planEntitlementSave(rows, next);
        expect(plan.updates).toEqual([]);
        expect(plan.errors).toHaveLength(1);
    });

    it('sends null only when unlimited is chosen explicitly', () => {
        const rows = buildEntitlementRows(res);
        const next = edit(rows, 'projects.max', { unlimited: true });
        expect(planEntitlementSave(rows, next).updates).toEqual([{ capability: 'projects.max', limitValue: null }]);
    });

    it('rejects negative or fractional limits', () => {
        const rows = buildEntitlementRows(res);
        expect(planEntitlementSave(rows, edit(rows, 'projects.max', { limitText: '-1' })).errors).toHaveLength(1);
        expect(planEntitlementSave(rows, edit(rows, 'projects.max', { limitText: '1.5' })).errors).toHaveLength(1);
    });

    it('turns a reset into an override deletion', () => {
        const rows = buildEntitlementRows(res);
        const next = rows.map((r) => (r.capability === 'alerts.max_rules' ? resetEntitlementRow(r) : r));
        const reset = next.find((r) => r.capability === 'alerts.max_rules')!;
        expect(reset).toMatchObject({ reset: true, unlimited: true });
        expect(planEntitlementSave(rows, next)).toEqual({ updates: [], resets: ['alerts.max_rules'], errors: [] });
    });
});

describe('formatEntitlementValue', () => {
    it('formats each kind', () => {
        expect(formatEntitlementValue({ kind: 'boolean', enabled: false })).toBe('off');
        expect(formatEntitlementValue({ kind: 'limit', limit: null })).toBe('unlimited');
        expect(formatEntitlementValue({ kind: 'quota', limit: 1048576 })).toBe('1,048,576');
        expect(formatEntitlementValue(null)).toBe('-');
    });
});
