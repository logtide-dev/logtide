import { describe, it, expect, afterEach, vi } from 'vitest';
import { reservoir } from '../../../database/reservoir.js';
import { webVitalsService, MAX_VITAL_SAMPLES, normalizeRoute } from '../../../modules/web-vitals/service.js';
import { percentile } from '../../../modules/web-vitals/percentile.js';

const FROM = new Date('2025-01-01T00:00:00Z');
const TO = new Date('2025-01-02T00:00:00Z');

function vital(metric: unknown, value: unknown, extra: Record<string, unknown> = {}) {
    return {
        id: 'id',
        time: FROM,
        service: 'web',
        level: 'info',
        message: 'web vital',
        metadata: { performance: { metric, value }, ...extra },
    };
}

function mockLogs(logs: any[]) {
    return vi.spyOn(reservoir, 'query').mockResolvedValue({
        logs, total: logs.length, hasMore: false, limit: MAX_VITAL_SAMPLES, offset: 0,
    } as any);
}

const summary = () => webVitalsService.getSummary({ projectId: 'p1', from: FROM, to: TO });

describe('percentile', () => {
    it('interpolates linearly and handles edges', () => {
        expect(percentile([], 0.75)).toBeNull();
        expect(percentile([7], 0.75)).toBe(7);
        expect(percentile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25);
        expect(percentile([10, 20], 0.5)).toBe(15);
        expect(percentile([1, 2, 3], 1)).toBe(3);
        expect(percentile([1, 2, 3], 0)).toBe(1);
    });
});

describe('normalizeRoute', () => {
    it('strips origin, query and hash and collapses the trailing slash', () => {
        expect(normalizeRoute('https://app.example.com/pricing/?a=1#x')).toBe('/pricing');
        expect(normalizeRoute('/')).toBe('/');
        expect(normalizeRoute('https://app.example.com')).toBe('/');
        expect(normalizeRoute('/a/b/')).toBe('/a/b');
        expect(normalizeRoute('')).toBe('(unknown)');
        expect(normalizeRoute(42)).toBe('(unknown)');
        expect(normalizeRoute('/' + 'x'.repeat(300)).length).toBe(200);
    });
});

describe('WebVitalsService.getSummary', () => {
    afterEach(() => vi.restoreAllMocks());

    it('queries the reservoir for performance.metric records, newest first, bounded', async () => {
        const spy = mockLogs([]);
        await summary();
        const args = spy.mock.calls[0][0] as any;
        expect(args).toMatchObject({
            projectId: 'p1', from: FROM, to: TO, sortBy: 'time', sortOrder: 'desc', limit: MAX_VITAL_SAMPLES,
        });
        expect(args.metadataFilters).toMatchObject([{ key: 'performance.metric', op: 'exists' }]);
    });

    it('computes p75 per metric with linear interpolation', async () => {
        mockLogs([1000, 2000, 3000, 4000].map((v) => vital('LCP', v)));
        const result = await summary();
        const lcp = result.metrics.find((m) => m.name === 'LCP')!;
        expect(lcp.p75).toBeCloseTo(3250);
        expect(lcp.samples).toBe(4);
        expect(lcp.rating).toBe('needs-improvement');
        expect(result.sampleCount).toBe(4);
        expect(result.projectId).toBe('p1');
        expect(result.from).toBe(FROM.toISOString());
    });

    it('splits good needs-improvement poor from thresholds not from sdk rating', async () => {
        mockLogs([
            { ...vital('LCP', 2500), metadata: { performance: { metric: 'LCP', value: 2500, rating: 'poor' } } },
            vital('LCP', 3000),
            vital('LCP', 4000),
            vital('LCP', 4001),
            vital('LCP', 9000),
        ]);
        const lcp = (await summary()).metrics.find((m) => m.name === 'LCP')!;
        expect(lcp.distribution).toEqual({ good: 1, needsImprovement: 2, poor: 2 });
    });

    it('skips malformed records and counts them', async () => {
        mockLogs([
            vital('LCP', 1000),
            vital('LCP', undefined),
            vital('LCP', 'NaN'),
            vital('LCP', NaN),
            vital('LCP', -5),
            vital('LCP', Infinity),
            vital('FID', 100),
            vital('lcp', 100),
            vital('INP', { v: 1 }),
            vital(7, 100),
            { ...vital('LCP', 1), metadata: undefined },
        ]);
        const result = await summary();
        expect(result.sampleCount).toBe(1);
        expect(result.skipped).toBe(10);
        expect(result.metrics.find((m) => m.name === 'LCP')!.p75).toBe(1000);
        expect(result.metrics.find((m) => m.name === 'INP')!.samples).toBe(0);
    });

    it('single sample p75 equals the value', async () => {
        mockLogs([vital('CLS', 0.07)]);
        const cls = (await summary()).metrics.find((m) => m.name === 'CLS')!;
        expect(cls.p75).toBe(0.07);
        expect(cls.rating).toBe('good');
    });

    it('no samples returns null p75 and zero samples for all five metrics', async () => {
        mockLogs([]);
        const result = await summary();
        expect(result.metrics.map((m) => m.name)).toEqual(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']);
        for (const m of result.metrics) {
            expect(m.p75).toBeNull();
            expect(m.rating).toBeNull();
            expect(m.samples).toBe(0);
            expect(m.distribution).toEqual({ good: 0, needsImprovement: 0, poor: 0 });
        }
        expect(result.sampleCount).toBe(0);
        expect(result.routes).toEqual([]);
        expect(result.truncated).toBe(false);
    });

    it('flags truncated at 10000', async () => {
        mockLogs(Array.from({ length: MAX_VITAL_SAMPLES }, () => vital('TTFB', 100)));
        const result = await summary();
        expect(result.truncated).toBe(true);
        expect(result.sampleCount).toBe(MAX_VITAL_SAMPLES);
    });

    it('groups routes by normalised pathname', async () => {
        mockLogs([
            vital('LCP', 1000, { page: { pathname: '/pricing/' } }),
            vital('LCP', 3000, { page: { url: 'https://x.io/pricing?utm=1' } }),
            vital('INP', 150, { page: { pathname: '/pricing' } }),
            vital('LCP', 5000, { 'http.route': '/home' }),
        ]);
        const result = await summary();
        const pricing = result.routes.find((r) => r.route === '/pricing')!;
        expect(pricing.samples).toBe(3);
        expect(pricing.metrics.LCP).toMatchObject({ p75: 2500, rating: 'good', samples: 2 });
        expect(pricing.metrics.INP).toMatchObject({ p75: 150, samples: 1 });
        expect(pricing.metrics.CLS).toBeUndefined();
        expect(result.routes.find((r) => r.route === '/home')!.metrics.LCP!.rating).toBe('poor');
        expect(result.routes[0].route).toBe('/pricing');
    });

    it('routes capped at 20 ordered by samples then route', async () => {
        const logs: any[] = [];
        for (let i = 0; i < 25; i++) {
            const route = `/r${String(i).padStart(2, '0')}`;
            logs.push(vital('LCP', 100, { page: { pathname: route } }));
        }
        logs.push(vital('LCP', 100, { page: { pathname: '/r24' } }));
        mockLogs(logs);
        const out = await summary();
        expect(out.routes.length).toBe(20);
        expect(out.routes[0]).toMatchObject({ route: '/r24', samples: 2 });
        expect(out.routes[1].route).toBe('/r00');
        expect(out.routes[19].route).toBe('/r18');
    });

    it('uses (unknown) when no route attribute', async () => {
        mockLogs([vital('LCP', 1000), vital('LCP', 1200, { page: { pathname: '   ' } })]);
        const result = await summary();
        expect(result.routes).toHaveLength(1);
        expect(result.routes[0].route).toBe('(unknown)');
        expect(result.routes[0].samples).toBe(2);
    });
});
