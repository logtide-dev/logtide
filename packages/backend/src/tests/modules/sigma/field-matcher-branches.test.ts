import { describe, it, expect, vi, afterEach } from 'vitest';
import { SigmaFieldMatcher } from '../../../modules/sigma/field-matcher.js';

// Pure unit tests (no database) covering the less common modifier paths of
// SigmaFieldMatcher: exists checks, encoding transforms, CIDR edge cases,
// case-sensitive wildcards/regex and unknown modifier fallback.

describe('SigmaFieldMatcher (modifier edge cases)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('|exists', () => {
        it('matches present fields when the pattern is true', () => {
            expect(SigmaFieldMatcher.matchSelection({ user: 'alice' }, { 'user|exists': true })).toBe(true);
            expect(SigmaFieldMatcher.matchSelection({}, { 'user|exists': true })).toBe(false);
        });

        it('matches absent fields when the pattern is false', () => {
            expect(SigmaFieldMatcher.matchSelection({}, { 'user|exists': false })).toBe(true);
            expect(SigmaFieldMatcher.matchSelection({ user: null }, { 'user|exists': false })).toBe(true);
            expect(SigmaFieldMatcher.matchSelection({ user: 'alice' }, { 'user|exists': false })).toBe(false);
        });

        it('treats a null intermediate object as absent for nested paths', () => {
            const log = { metadata: null };
            expect(SigmaFieldMatcher.matchSelection(log, { 'metadata.user.id|exists': false })).toBe(true);
            expect(SigmaFieldMatcher.matchSelection(log, { 'metadata.user.id': 'x' })).toBe(false);
        });
    });

    describe('unknown modifiers', () => {
        it('warns once and falls back to equality matching', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            expect(SigmaFieldMatcher.matchSelection({ f: 'abc' }, { 'f|bogusmodifierx': 'abc' })).toBe(true);
            expect(SigmaFieldMatcher.matchSelection({ f: 'abc' }, { 'f|bogusmodifierx': 'ab' })).toBe(false);

            const calls = warn.mock.calls.filter((c) => String(c[0]).includes('bogusmodifierx'));
            expect(calls).toHaveLength(1);
        });

        it('does not warn for the all modifier inside a single-value chain', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(SigmaFieldMatcher.match('abc', 'abc', { modifier: 'all' })).toBe(true);
            expect(warn).not.toHaveBeenCalled();
        });
    });

    describe('encoding transforms', () => {
        it('utf16be encodes the pattern big-endian before comparing', () => {
            const encoded = '\u0000a\u0000b';
            expect(SigmaFieldMatcher.matchSelection(
                { blob: `xx${encoded}yy` },
                { 'blob|utf16be|contains': 'ab' },
            )).toBe(true);
            // Little-endian bytes must not satisfy a big-endian pattern
            expect(SigmaFieldMatcher.matchSelection(
                { blob: 'xxa\u0000b\u0000yy' },
                { 'blob|utf16be|contains': 'ab' },
            )).toBe(false);
        });

        it('wide then base64 encodes the utf16le bytes and implies contains', () => {
            const b64 = Buffer.from('ab', 'utf16le').toString('base64');
            expect(b64).toBe('YQBiAA==');
            expect(SigmaFieldMatcher.matchSelection(
                { cmd: `powershell -enc ${b64}` },
                { 'cmd|wide|base64': 'ab' },
            )).toBe(true);
            // Plain utf8 base64 of the same text is a different string
            expect(SigmaFieldMatcher.matchSelection(
                { cmd: `powershell -enc ${Buffer.from('ab').toString('base64')}` },
                { 'cmd|wide|base64': 'ab' },
            )).toBe(false);
        });

        it('base64offset alone matches the pattern at every byte alignment', () => {
            // 12-byte pattern: its length is a multiple of 3, the case the fixed
            // offset table handles for all three alignments.
            for (const prefix of ['', 'X', 'XY']) {
                const blob = Buffer.from(`${prefix}invoke-shell trailing`).toString('base64');
                expect(SigmaFieldMatcher.matchSelection(
                    { data: blob },
                    { 'data|base64offset': 'invoke-shell' },
                )).toBe(true);
            }
            const unrelated = Buffer.from('nothing to see here').toString('base64');
            expect(SigmaFieldMatcher.matchSelection(
                { data: unrelated },
                { 'data|base64offset': 'invoke-shell' },
            )).toBe(false);
        });

        it('windash leaves hyphen-free patterns unchanged', () => {
            expect(SigmaFieldMatcher.matchSelection({ cmd: 'whoami' }, { 'cmd|windash': 'whoami' })).toBe(true);
            expect(SigmaFieldMatcher.matchSelection({ cmd: 'whoami /all' }, { 'cmd|windash': 'whoami' })).toBe(false);
        });

        it('windash expands hyphens into slash and unicode dash variants', () => {
            expect(SigmaFieldMatcher.matchSelection({ cmd: 'net user /add' }, { 'cmd|windash|contains': ' -add' })).toBe(true);
            const enDash = String.fromCharCode(0x2013);
            expect(SigmaFieldMatcher.matchSelection({ cmd: `net user ${enDash}add` }, { 'cmd|windash|contains': '-add' })).toBe(true);
            expect(SigmaFieldMatcher.matchSelection({ cmd: 'net user +add' }, { 'cmd|windash|contains': '-add' })).toBe(false);
        });
    });

    describe('case-sensitive matching', () => {
        it('honors case sensitivity for wildcard patterns', () => {
            expect(SigmaFieldMatcher.match('Hello World', 'Hello*', { caseSensitive: true })).toBe(true);
            expect(SigmaFieldMatcher.match('Hello World', 'hello*', { caseSensitive: true })).toBe(false);
            expect(SigmaFieldMatcher.match('Hello World', 'hello*')).toBe(true);
        });

        it('honors case sensitivity for regex patterns', () => {
            expect(SigmaFieldMatcher.match('ABC', '^abc$', { modifier: 're', caseSensitive: true })).toBe(false);
            expect(SigmaFieldMatcher.match('ABC', '^ABC$', { modifier: 're', caseSensitive: true })).toBe(true);
            expect(SigmaFieldMatcher.match('ABC', '^abc$', { modifier: 're' })).toBe(true);
        });

        it('passes the case flag through matchSelection', () => {
            expect(SigmaFieldMatcher.matchSelection({ f: 'Admin' }, { 'f|startswith': 'adm' }, true)).toBe(false);
            expect(SigmaFieldMatcher.matchSelection({ f: 'Admin' }, { 'f|startswith': 'Adm' }, true)).toBe(true);
        });
    });

    describe('|cidr edge cases', () => {
        it('treats a bare address as a /32 equality check', () => {
            expect(SigmaFieldMatcher.match('10.0.0.1', '10.0.0.1', { modifier: 'cidr' })).toBe(true);
            expect(SigmaFieldMatcher.match('10.0.0.2', '10.0.0.1', { modifier: 'cidr' })).toBe(false);
            expect(SigmaFieldMatcher.match('not-an-ip', '10.0.0.1', { modifier: 'cidr' })).toBe(false);
            expect(SigmaFieldMatcher.match('10.0.0.1', 'garbage', { modifier: 'cidr' })).toBe(false);
        });

        it('matches every IPv4 address against /0', () => {
            expect(SigmaFieldMatcher.match('203.0.113.9', '0.0.0.0/0', { modifier: 'cidr' })).toBe(true);
            expect(SigmaFieldMatcher.match('1.2.3.4', '0.0.0.0/0', { modifier: 'cidr' })).toBe(true);
        });

        it('rejects malformed prefixes', () => {
            expect(SigmaFieldMatcher.match('10.0.0.1', '10.0.0.0/33', { modifier: 'cidr' })).toBe(false);
            expect(SigmaFieldMatcher.match('10.0.0.1', '10.0.0.0/-1', { modifier: 'cidr' })).toBe(false);
            expect(SigmaFieldMatcher.match('10.0.0.1', '10.0.0.0/abc', { modifier: 'cidr' })).toBe(false);
            expect(SigmaFieldMatcher.match('10.0.0.1', '10.0.0/8', { modifier: 'cidr' })).toBe(false);
        });

        it('rejects malformed IPv4 values', () => {
            expect(SigmaFieldMatcher.match('10.0.0', '10.0.0.0/8', { modifier: 'cidr' })).toBe(false);
            expect(SigmaFieldMatcher.match('10.0.0.a', '10.0.0.0/8', { modifier: 'cidr' })).toBe(false);
            expect(SigmaFieldMatcher.match('10.0.0.256', '10.0.0.0/8', { modifier: 'cidr' })).toBe(false);
            expect(SigmaFieldMatcher.match(' 10.1.2.3 ', '10.0.0.0/8', { modifier: 'cidr' })).toBe(true);
        });
    });

    describe('numeric comparators', () => {
        it('compares numeric strings and rejects non-numeric input', () => {
            expect(SigmaFieldMatcher.match('500', '499', { modifier: 'gt' })).toBe(true);
            expect(SigmaFieldMatcher.match(500, '500', { modifier: 'gte' })).toBe(true);
            expect(SigmaFieldMatcher.match(500, '500', { modifier: 'lt' })).toBe(false);
            expect(SigmaFieldMatcher.match(500, '500', { modifier: 'lte' })).toBe(true);
            expect(SigmaFieldMatcher.match('abc', '1', { modifier: 'gt' })).toBe(false);
            expect(SigmaFieldMatcher.match(5, 'abc', { modifier: 'lt' })).toBe(false);
        });
    });
});
