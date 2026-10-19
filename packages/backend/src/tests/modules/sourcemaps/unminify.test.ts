import { describe, it, expect, vi, afterEach } from 'vitest';
import { SourceMapGenerator, SourceMapConsumer } from 'source-map';
import { SourceMapUnminifier } from '../../../modules/sourcemaps/unminify.js';
import type { SourceMapsService } from '../../../modules/sourcemaps/service.js';
import type { StackFrame } from '../../../modules/exceptions/types.js';

const ORIGINAL_SOURCE = [
    'line 1',
    'line 2',
    'line 3',
    'line 4',
    'line 5',
    'line 6',
    'line 7',
    'line 8',
].join('\n');

/**
 * Build a small real source map for app.min.js with:
 * - 1:10 -> src/app.ts 5:2 named "handleClick" (source content included)
 * - 1:30 -> src/app.ts 1:0 without a name
 * - 1:50 -> src/other.ts 3:4 (no source content)
 * - 1:70 -> src/short.ts 20:0 (source content shorter than the mapped line)
 */
function buildMap(): string {
    const gen = new SourceMapGenerator({ file: 'app.min.js' });
    gen.addMapping({
        generated: { line: 1, column: 10 },
        original: { line: 5, column: 2 },
        source: 'src/app.ts',
        name: 'handleClick',
    });
    gen.addMapping({
        generated: { line: 1, column: 30 },
        original: { line: 1, column: 0 },
        source: 'src/app.ts',
    });
    gen.addMapping({
        generated: { line: 1, column: 50 },
        original: { line: 3, column: 4 },
        source: 'src/other.ts',
    });
    gen.addMapping({
        generated: { line: 1, column: 70 },
        original: { line: 20, column: 0 },
        source: 'src/short.ts',
    });
    gen.setSourceContent('src/app.ts', ORIGINAL_SOURCE);
    gen.setSourceContent('src/short.ts', 'only\ntwo lines');
    return gen.toString();
}

function makeService(content: Buffer | null | Error | string) {
    const getMapContent = vi.fn(async () => {
        if (content instanceof Error) throw content;
        if (typeof content === 'string') throw content;
        return content;
    });
    return {
        service: { getMapContent } as unknown as SourceMapsService,
        getMapContent,
    };
}

function frame(overrides: Partial<StackFrame>): StackFrame {
    return {
        frameIndex: 0,
        filePath: 'https://cdn.example.com/static/app.min.js',
        isAppCode: true,
        ...overrides,
    };
}

describe('SourceMapUnminifier', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the same empty array without touching the service', async () => {
        const { service, getMapContent } = makeService(null);
        const frames: StackFrame[] = [];
        const result = await new SourceMapUnminifier(service).unminifyFrames(frames, 'p1', '1.0.0');
        expect(result).toBe(frames);
        expect(getMapContent).not.toHaveBeenCalled();
    });

    it('skips frames without a file path or line number', async () => {
        const { service, getMapContent } = makeService(null);
        const frames = [
            frame({ filePath: '', lineNumber: 1 }),
            frame({ lineNumber: undefined }),
            frame({ lineNumber: 0 }),
        ];
        await new SourceMapUnminifier(service).unminifyFrames(frames, 'p1', '1.0.0');
        expect(getMapContent).not.toHaveBeenCalled();
        expect(frames.every((f) => f.originalFile === undefined)).toBe(true);
    });

    it('groups frames by map name, stripping query strings, and fetches each map once', async () => {
        const { service, getMapContent } = makeService(null);
        const frames = [
            frame({ filePath: 'https://cdn.example.com/app.min.js?v=123', lineNumber: 1 }),
            frame({ filePath: '/static/app.min.js', lineNumber: 2 }),
            frame({ filePath: '/static/vendor.js', lineNumber: 1 }),
        ];
        await new SourceMapUnminifier(service).unminifyFrames(frames, 'proj', 'rel');
        expect(getMapContent).toHaveBeenCalledTimes(2);
        expect(getMapContent).toHaveBeenCalledWith('proj', 'rel', 'app.min.js.map');
        expect(getMapContent).toHaveBeenCalledWith('proj', 'rel', 'vendor.js.map');
    });

    it('leaves frames unchanged when no map content is stored', async () => {
        const { service } = makeService(null);
        const frames = [frame({ lineNumber: 1, columnNumber: 10 })];
        await new SourceMapUnminifier(service).unminifyFrames(frames, 'p1', '1.0.0');
        expect(frames[0].originalFile).toBeUndefined();
        expect(frames[0].codeContext).toBeUndefined();
    });

    it('resolves original position, function name and code context', async () => {
        const { service } = makeService(Buffer.from(buildMap(), 'utf-8'));
        const frames = [frame({ lineNumber: 1, columnNumber: 10 })];
        const result = await new SourceMapUnminifier(service).unminifyFrames(frames, 'p1', '1.0.0');

        expect(result[0].originalFile).toBe('src/app.ts');
        expect(result[0].originalLine).toBe(5);
        expect(result[0].originalColumn).toBe(2);
        expect(result[0].originalFunction).toBe('handleClick');
        expect(result[0].codeContext).toEqual({
            pre: ['line 2', 'line 3', 'line 4'],
            line: 'line 5',
            post: ['line 6', 'line 7', 'line 8'],
        });
    });

    it('clamps the pre context at the start of the file and leaves function undefined when unnamed', async () => {
        const { service } = makeService(Buffer.from(buildMap(), 'utf-8'));
        const frames = [frame({ lineNumber: 1, columnNumber: 30 })];
        await new SourceMapUnminifier(service).unminifyFrames(frames, 'p1', '1.0.0');

        expect(frames[0].originalFile).toBe('src/app.ts');
        expect(frames[0].originalLine).toBe(1);
        expect(frames[0].originalFunction).toBeUndefined();
        expect(frames[0].codeContext).toEqual({
            pre: [],
            line: 'line 1',
            post: ['line 2', 'line 3', 'line 4'],
        });
    });

    it('sets the original location but no code context when sourcesContent is missing', async () => {
        const { service } = makeService(Buffer.from(buildMap(), 'utf-8'));
        const frames = [frame({ lineNumber: 1, columnNumber: 50 })];
        await new SourceMapUnminifier(service).unminifyFrames(frames, 'p1', '1.0.0');

        expect(frames[0].originalFile).toBe('src/other.ts');
        expect(frames[0].originalLine).toBe(3);
        expect(frames[0].codeContext).toBeUndefined();
    });

    it('skips code context when the mapped line is beyond the source content', async () => {
        const { service } = makeService(Buffer.from(buildMap(), 'utf-8'));
        const existing = { line: 'minified' };
        const frames = [frame({ lineNumber: 1, columnNumber: 70, codeContext: existing })];
        await new SourceMapUnminifier(service).unminifyFrames(frames, 'p1', '1.0.0');

        expect(frames[0].originalFile).toBe('src/short.ts');
        expect(frames[0].originalLine).toBe(20);
        expect(frames[0].codeContext).toBe(existing);
    });

    it('defaults a missing column to 0 and skips frames with no mapping', async () => {
        const { service } = makeService(Buffer.from(buildMap(), 'utf-8'));
        // Column 0 on line 1 precedes the first mapping, line 9 has no mappings at all
        const frames = [
            frame({ lineNumber: 1 }),
            frame({ lineNumber: 9, columnNumber: 5 }),
        ];
        await new SourceMapUnminifier(service).unminifyFrames(frames, 'p1', '1.0.0');

        expect(frames[0].originalFile).toBeUndefined();
        expect(frames[1].originalFile).toBeUndefined();
    });

    it('logs and continues when the map content is not valid JSON', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { service } = makeService(Buffer.from('not json', 'utf-8'));
        const frames = [frame({ lineNumber: 1, columnNumber: 10 })];
        const result = await new SourceMapUnminifier(service).unminifyFrames(frames, 'p1', 'r1');

        expect(result[0].originalFile).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('Failed to process app.min.js.map for project p1 release r1');
        expect(typeof warn.mock.calls[0][1]).toBe('string');
    });

    it('logs the raw value when a non-Error is thrown while fetching the map', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { service } = makeService('storage offline');
        const frames = [frame({ lineNumber: 1 })];
        await new SourceMapUnminifier(service).unminifyFrames(frames, 'p1', 'r1');

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('Failed to process app.min.js.map'),
            'storage offline',
        );
    });

    it('logs the error message when fetching the map throws an Error', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { service } = makeService(new Error('bucket missing'));
        await new SourceMapUnminifier(service).unminifyFrames([frame({ lineNumber: 1 })], 'p1', 'r1');
        expect(warn.mock.calls[0][1]).toBe('bucket missing');
    });

    it('maps null line/column from the consumer to undefined and skips context', async () => {
        const fakeConsumer = {
            originalPositionFor: vi.fn(() => ({ source: 'src/x.ts', line: null, column: null, name: null })),
            sourceContentFor: vi.fn(() => 'some content'),
        };
        vi.spyOn(SourceMapConsumer, 'with').mockImplementation(
            (async (_raw: unknown, _url: unknown, cb: (c: unknown) => unknown) => cb(fakeConsumer)) as never,
        );
        const { service } = makeService(Buffer.from('{}', 'utf-8'));
        const frames = [frame({ lineNumber: 4, columnNumber: 2 })];
        await new SourceMapUnminifier(service).unminifyFrames(frames, 'p1', 'r1');

        expect(fakeConsumer.originalPositionFor).toHaveBeenCalledWith({ line: 4, column: 2 });
        expect(frames[0].originalFile).toBe('src/x.ts');
        expect(frames[0].originalLine).toBeUndefined();
        expect(frames[0].originalColumn).toBeUndefined();
        expect(frames[0].originalFunction).toBeUndefined();
        expect(frames[0].codeContext).toBeUndefined();
    });

    it('skips a frame whose resolution throws but still processes the others', async () => {
        let call = 0;
        const fakeConsumer = {
            originalPositionFor: vi.fn(() => {
                call++;
                if (call === 1) throw new Error('bad mapping');
                return { source: 'src/ok.ts', line: 2, column: 1, name: 'ok' };
            }),
            sourceContentFor: vi.fn(() => null),
        };
        vi.spyOn(SourceMapConsumer, 'with').mockImplementation(
            (async (_raw: unknown, _url: unknown, cb: (c: unknown) => unknown) => cb(fakeConsumer)) as never,
        );
        const { service } = makeService(Buffer.from('{}', 'utf-8'));
        const frames = [frame({ lineNumber: 1 }), frame({ lineNumber: 2 })];
        await new SourceMapUnminifier(service).unminifyFrames(frames, 'p1', 'r1');

        expect(frames[0].originalFile).toBeUndefined();
        expect(frames[1].originalFile).toBe('src/ok.ts');
        expect(frames[1].originalFunction).toBe('ok');
        expect(frames[1].codeContext).toBeUndefined();
    });

    it('falls back to line 1 when the line number disappears after grouping', async () => {
        const fakeConsumer = {
            originalPositionFor: vi.fn(() => ({ source: null, line: null, column: null, name: null })),
            sourceContentFor: vi.fn(),
        };
        vi.spyOn(SourceMapConsumer, 'with').mockImplementation(
            (async (_raw: unknown, _url: unknown, cb: (c: unknown) => unknown) => cb(fakeConsumer)) as never,
        );
        const f = frame({ lineNumber: 3 });
        const getMapContent = vi.fn(async () => {
            // Simulate a concurrent mutation of the frame between grouping and resolution
            f.lineNumber = undefined;
            return Buffer.from('{}', 'utf-8');
        });
        const service = { getMapContent } as unknown as SourceMapsService;
        await new SourceMapUnminifier(service).unminifyFrames([f], 'p1', 'r1');

        expect(fakeConsumer.originalPositionFor).toHaveBeenCalledWith({ line: 1, column: 0 });
        expect(fakeConsumer.sourceContentFor).not.toHaveBeenCalled();
        expect(f.originalFile).toBeUndefined();
    });
});
