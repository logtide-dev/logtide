import { isUuid } from './params.js';

export const MAX_ADMIN_PAGE = 1_000_000;
export const MAX_ADMIN_LIMIT = 200;

export const USER_SORTS = ['email', 'name', 'created_at', 'last_login'] as const;
export const ORGANIZATION_SORTS = ['name', 'created_at', 'members', 'projects'] as const;
export const PROJECT_SORTS = ['name', 'created_at', 'organization'] as const;

export type UserSort = (typeof USER_SORTS)[number];
export type OrganizationSort = (typeof ORGANIZATION_SORTS)[number];
export type ProjectSort = (typeof PROJECT_SORTS)[number];
export type SortOrder = 'asc' | 'desc';
export type DeletedFilter = 'exclude' | 'include' | 'only';

export class AdminBadRequestError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AdminBadRequestError';
    }
}

type Raw = Record<string, unknown>;

function str(raw: Raw, key: string): string | undefined {
    const v = raw[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'string') throw new AdminBadRequestError(`Invalid ${key}`);
    return v;
}

function oneOf<T extends string>(key: string, value: string | undefined, allowed: readonly T[]): T | undefined {
    if (value === undefined || value === '') return undefined;
    if (!(allowed as readonly string[]).includes(value)) {
        throw new AdminBadRequestError(`Invalid ${key}: must be one of ${allowed.join(', ')}`);
    }
    return value as T;
}

function intParam(key: string, value: string | undefined, def: number): number {
    if (value === undefined) return def;
    if (!/^\d+$/.test(value.trim())) {
        throw new AdminBadRequestError(`Invalid ${key}: must be a positive integer`);
    }
    return parseInt(value, 10);
}

/** page/limit/search/sort/order shared by the three list endpoints. Throws AdminBadRequestError. */
export function parseListQuery<S extends string>(rawQuery: unknown, sorts: readonly S[]) {
    const raw = (rawQuery ?? {}) as Raw;
    const page = intParam('page', str(raw, 'page'), 1);
    if (page < 1 || page > MAX_ADMIN_PAGE) {
        throw new AdminBadRequestError(`Invalid page: must be between 1 and ${MAX_ADMIN_PAGE}`);
    }
    const limitRaw = intParam('limit', str(raw, 'limit'), 50);
    if (limitRaw < 1) {
        throw new AdminBadRequestError(`Invalid limit: must be between 1 and ${MAX_ADMIN_LIMIT}`);
    }
    const limit = Math.min(limitRaw, MAX_ADMIN_LIMIT);
    const sort = oneOf('sort', str(raw, 'sort'), sorts);
    const order = oneOf<SortOrder>('order', str(raw, 'order'), ['asc', 'desc']);
    return { page, limit, search: str(raw, 'search'), sort, order: order ?? 'desc', raw };
}

export function parseUserFilters(raw: Raw) {
    return {
        role: oneOf('role', str(raw, 'role'), ['admin', 'user'] as const),
        status: oneOf('status', str(raw, 'status'), ['active', 'disabled'] as const),
    };
}

export function parseProjectFilters(raw: Raw) {
    const organizationId = str(raw, 'organizationId');
    if (organizationId !== undefined && organizationId !== '' && !isUuid(organizationId)) {
        throw new AdminBadRequestError('Invalid organizationId: must be a UUID');
    }
    return {
        organizationId: organizationId || undefined,
        deleted: oneOf<DeletedFilter>('deleted', str(raw, 'deleted'), ['exclude', 'include', 'only']) ?? 'exclude',
    };
}
