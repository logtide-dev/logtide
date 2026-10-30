import { describe, it, expect } from 'vitest';
import { parseUserAgent } from '../../../modules/sessions/user-agent.js';

describe('parseUserAgent', () => {
    it('parses Chrome on Windows desktop', () => {
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
        expect(parseUserAgent(ua)).toEqual({ browser: 'Chrome', os: 'Windows', device: 'desktop' });
    });

    it('parses Safari on iPhone as mobile', () => {
        const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
        expect(parseUserAgent(ua)).toEqual({ browser: 'Safari', os: 'iOS', device: 'mobile' });
    });

    it('returns empty for undefined', () => {
        expect(parseUserAgent(undefined)).toEqual({});
        expect(parseUserAgent('')).toEqual({});
        expect(parseUserAgent('curl/8.0')).toEqual({});
    });

    it('parses Firefox on Android as mobile', () => {
        const ua = 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0';
        expect(parseUserAgent(ua)).toEqual({ browser: 'Firefox', os: 'Android', device: 'mobile' });
    });

    it('parses Edge before Chrome and iPad as tablet', () => {
        expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36 Edg/126.0').browser).toBe('Edge');
        expect(parseUserAgent('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1').device).toBe('tablet');
    });

    it('parses Safari on macOS and Opera on Linux', () => {
        expect(parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15')).toEqual({ browser: 'Safari', os: 'macOS', device: 'desktop' });
        expect(parseUserAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0 Safari/537.36 OPR/110.0')).toMatchObject({ browser: 'Opera', os: 'Linux' });
    });
});
