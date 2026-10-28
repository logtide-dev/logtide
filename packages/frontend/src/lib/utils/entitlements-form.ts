import type {
    EntitlementMap,
    EntitlementOverride,
    EntitlementUpdate,
    EntitlementValue,
    EntitlementsResponse,
} from '$lib/api/admin';

/**
 * Editable row for one capability on the admin org entitlements card.
 *
 * Numeric caps have an explicit "unlimited" flag: an empty input is never
 * turned into a `null` (unlimited) override on its own.
 */
export interface EntitlementRow {
    capability: string;
    kind: EntitlementValue['kind'];
    /** True when the org has an explicit row (not inheriting the default). */
    isOverride: boolean;
    /** Default value for this capability, when the server reported it. */
    defaultValue: EntitlementValue | null;
    enabled: boolean;
    limitText: string;
    unlimited: boolean;
    /** Pending "reset to default": the override is deleted on save. */
    reset: boolean;
}

function fromValue(value: EntitlementValue | null): Pick<EntitlementRow, 'enabled' | 'limitText' | 'unlimited'> {
    if (!value) return { enabled: false, limitText: '', unlimited: true };
    if (value.kind === 'boolean') return { enabled: value.enabled, limitText: '', unlimited: false };
    return {
        enabled: false,
        limitText: value.limit === null ? '' : String(value.limit),
        unlimited: value.limit === null,
    };
}

export function buildEntitlementRows(res: EntitlementsResponse): EntitlementRow[] {
    const defaults: EntitlementMap = res.defaults ?? {};
    const overrides: Record<string, EntitlementOverride> = res.overrides ?? {};
    return Object.keys(res.entitlements)
        .sort()
        .map((capability) => {
            const value = res.entitlements[capability];
            return {
                capability,
                kind: value.kind,
                isOverride: capability in overrides,
                defaultValue: defaults[capability] ?? null,
                reset: false,
                ...fromValue(value),
            };
        });
}

/** Put a row back to its default value and mark the override for deletion. */
export function resetEntitlementRow(row: EntitlementRow): EntitlementRow {
    return { ...row, ...fromValue(row.defaultValue), reset: row.isOverride };
}

/** Human text for a default value ("on", "off", "unlimited", "1,000"). */
export function formatEntitlementValue(value: EntitlementValue | null): string {
    if (!value) return '-';
    if (value.kind === 'boolean') return value.enabled ? 'on' : 'off';
    return value.limit === null ? 'unlimited' : value.limit.toLocaleString('en-US');
}

type NumericValue = { ok: true; value: number | null } | { ok: false; error: string };

function numericValue(row: EntitlementRow): NumericValue {
    if (row.unlimited) return { ok: true, value: null };
    const raw = row.limitText.trim();
    if (raw === '') {
        return { ok: false, error: `${row.capability}: enter a limit or choose unlimited` };
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
        return { ok: false, error: `${row.capability}: must be a non-negative integer` };
    }
    return { ok: true, value: n };
}

export interface EntitlementSavePlan {
    updates: EntitlementUpdate[];
    resets: string[];
    errors: string[];
}

/**
 * Diff the edited rows against the loaded ones: only changed capabilities are
 * written, and pending resets become override deletions.
 */
export function planEntitlementSave(initial: EntitlementRow[], current: EntitlementRow[]): EntitlementSavePlan {
    const before = new Map(initial.map((r) => [r.capability, r]));
    const plan: EntitlementSavePlan = { updates: [], resets: [], errors: [] };

    for (const row of current) {
        const orig = before.get(row.capability);
        if (!orig) continue;

        if (row.reset) {
            plan.resets.push(row.capability);
            continue;
        }

        if (row.kind === 'boolean') {
            if (row.enabled !== orig.enabled) {
                plan.updates.push({ capability: row.capability, enabled: row.enabled });
            }
            continue;
        }

        const next = numericValue(row);
        if (next.ok === false) {
            plan.errors.push(next.error);
            continue;
        }
        const prev = numericValue(orig);
        if (!prev.ok || prev.value !== next.value) {
            plan.updates.push({ capability: row.capability, limitValue: next.value });
        }
    }

    return plan;
}
