import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * Tests against the real NetapiReputationService class.
 * fs, global.fetch and the config are mocked, so no network or disk access is needed.
 */

const {
  mockExistsSync,
  mockMkdirSync,
  mockStatSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockRenameSync,
  mockRmSync,
  mockConfig,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockRenameSync: vi.fn(),
  mockRmSync: vi.fn(),
  mockConfig: { NETAPI_REPUTATION_ENABLED: true },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    statSync: mockStatSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    renameSync: mockRenameSync,
    rmSync: mockRmSync,
  },
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  statSync: mockStatSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  renameSync: mockRenameSync,
  rmSync: mockRmSync,
}));

vi.mock('../../../config/index.js', () => ({ config: mockConfig }));

import { netapiReputationService, NETAPI_ATTRIBUTION } from '../../../modules/siem/netapi-service.js';

const SAMPLE_LIST = [
  '# NetAPI.com - currently compromised IPs (2026-11-17).',
  '1.2.3.4',
  '5.6.7.8',
  '',
  'not-an-ip',
  '2001:db8::1',
  '  9.10.11.12  ',
].join('\n');

const MTIME = new Date('2026-11-17T04:31:00Z');

function resetService() {
  const s = netapiReputationService as unknown as Record<string, unknown>;
  s['ipDatabase'] = new Set<string>();
  s['lastUpdate'] = null;
  s['lastCheck'] = null;
  s['lastReloadCheck'] = 0;
  s['isUpdating'] = false;
  s['isReady'] = false;
}

function okResponse(body: string) {
  return { ok: true, status: 200, statusText: 'OK', text: () => Promise.resolve(body) };
}

describe('NetapiReputationService (real module)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetService();
    mockConfig.NETAPI_REPUTATION_ENABLED = true;
    mockStatSync.mockReturnValue({ mtime: MTIME });
    mockReadFileSync.mockReturnValue(SAMPLE_LIST);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('enabled / disabled', () => {
    it('does nothing when NETAPI_REPUTATION_ENABLED is false', async () => {
      mockConfig.NETAPI_REPUTATION_ENABLED = false;
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      expect(await netapiReputationService.initialize()).toBe(false);
      expect(await netapiReputationService.downloadDatabase()).toBe(false);
      expect(netapiReputationService.needsUpdate()).toBe(false);
      expect(netapiReputationService.ready()).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('is not ready once disabled, even with a loaded list', async () => {
      mockExistsSync.mockReturnValue(true);
      await netapiReputationService.initialize();
      expect(netapiReputationService.ready()).toBe(true);

      mockConfig.NETAPI_REPUTATION_ENABLED = false;
      expect(netapiReputationService.ready()).toBe(false);
      expect(netapiReputationService.getInfo().enabled).toBe(false);
    });
  });

  describe('initialize', () => {
    it('loads the file on disk: comments, blank lines, non-IPv4 lines skipped', async () => {
      mockExistsSync.mockReturnValue(true);

      expect(await netapiReputationService.initialize()).toBe(true);
      expect(netapiReputationService.getInfo().totalIps).toBe(3);
      expect(netapiReputationService.checkIp('1.2.3.4').listed).toBe(true);
      expect(netapiReputationService.checkIp('9.10.11.12').listed).toBe(true);
      expect(netapiReputationService.checkIp('8.8.8.8').listed).toBe(false);
      expect(netapiReputationService.checkIp('2001:db8::1').listed).toBe(false);
    });

    it('creates the data directory and downloads the list when it is missing', async () => {
      // dir missing, file missing (initialize and download), then present for the load
      mockExistsSync
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValue(true);
      const fetchSpy = vi.fn().mockResolvedValue(okResponse(SAMPLE_LIST));
      vi.stubGlobal('fetch', fetchSpy);

      expect(await netapiReputationService.initialize()).toBe(true);
      expect(mockMkdirSync).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://netapi.com/api2/?method=compromised&dataset_type=ip',
        { headers: { 'User-Agent': 'LogTide/1.0' } }
      );
      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(mockRenameSync).toHaveBeenCalled();
      expect(netapiReputationService.ready()).toBe(true);
    });

    it('returns false when the first download fails', async () => {
      mockExistsSync.mockReturnValue(false);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' }));

      expect(await netapiReputationService.initialize()).toBe(false);
      expect(netapiReputationService.ready()).toBe(false);
    });

    it('returns false when the file cannot be read', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('EACCES');
      });

      expect(await netapiReputationService.initialize()).toBe(false);
      expect(netapiReputationService.ready()).toBe(false);
    });
  });

  describe('downloadDatabase', () => {
    it('sends If-Modified-Since with the file time and keeps the list on 304', async () => {
      mockExistsSync.mockReturnValue(true);
      const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 304, statusText: 'Not Modified' });
      vi.stubGlobal('fetch', fetchSpy);

      expect(await netapiReputationService.downloadDatabase()).toBe(true);
      expect(fetchSpy.mock.calls[0][1].headers['If-Modified-Since']).toBe(MTIME.toUTCString());
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      // 304 counts as a successful check and loads the list kept on disk
      expect(netapiReputationService.needsUpdate()).toBe(false);
      expect(netapiReputationService.ready()).toBe(true);
    });

    it('does not replace the list with an answer that holds no addresses', async () => {
      mockExistsSync.mockReturnValue(true);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('<html>error</html>')));

      expect(await netapiReputationService.downloadDatabase()).toBe(false);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockRenameSync).not.toHaveBeenCalled();
    });

    it('removes the temp file when writing fails', async () => {
      mockExistsSync.mockReturnValue(true);
      mockRenameSync.mockImplementationOnce(() => {
        throw new Error('EXDEV');
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(SAMPLE_LIST)));

      expect(await netapiReputationService.downloadDatabase()).toBe(false);
      expect(mockRmSync).toHaveBeenCalled();
    });

    it('skips a second download while one is running', async () => {
      mockExistsSync.mockReturnValue(true);
      let release: (v: unknown) => void = () => {};
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((r) => (release = r))));

      const first = netapiReputationService.downloadDatabase();
      expect(await netapiReputationService.downloadDatabase()).toBe(false);
      release(okResponse(SAMPLE_LIST));
      expect(await first).toBe(true);
    });
  });

  describe('needsUpdate', () => {
    it('is due before the first check and again after an hour', async () => {
      expect(netapiReputationService.needsUpdate()).toBe(true);

      (netapiReputationService as unknown as Record<string, unknown>)['lastCheck'] = new Date(Date.now() - 30 * 60 * 1000);
      expect(netapiReputationService.needsUpdate()).toBe(false);

      (netapiReputationService as unknown as Record<string, unknown>)['lastCheck'] = new Date(Date.now() - 61 * 60 * 1000);
      expect(netapiReputationService.needsUpdate()).toBe(true);
    });
  });

  describe('reload from disk', () => {
    it('re-reads the file when another process replaced it', async () => {
      mockExistsSync.mockReturnValue(true);
      await netapiReputationService.initialize();
      expect(netapiReputationService.checkIp('7.7.7.7').listed).toBe(false);

      // the worker wrote a newer list
      mockStatSync.mockReturnValue({ mtime: new Date(MTIME.getTime() + 3600_000) });
      mockReadFileSync.mockReturnValue('# list\n7.7.7.7\n');
      (netapiReputationService as unknown as Record<string, unknown>)['lastReloadCheck'] = 0;

      expect(netapiReputationService.checkIp('7.7.7.7').listed).toBe(true);
      expect(netapiReputationService.checkIp('1.2.3.4').listed).toBe(false);
    });

    it('checks the file at most once a minute', async () => {
      mockExistsSync.mockReturnValue(true);
      await netapiReputationService.initialize();
      mockStatSync.mockClear();

      netapiReputationService.checkIp('1.2.3.4');
      netapiReputationService.checkIp('5.6.7.8');
      expect(mockStatSync).not.toHaveBeenCalled();
    });

    it('keeps the list when the file check fails', async () => {
      mockExistsSync.mockReturnValue(true);
      await netapiReputationService.initialize();
      (netapiReputationService as unknown as Record<string, unknown>)['lastReloadCheck'] = 0;
      mockStatSync.mockImplementation(() => {
        throw new Error('EIO');
      });

      expect(netapiReputationService.checkIp('1.2.3.4').listed).toBe(true);
    });
  });

  describe('getInfo / attribution', () => {
    it('reports the loaded list', async () => {
      mockExistsSync.mockReturnValue(true);
      await netapiReputationService.initialize();

      const info = netapiReputationService.getInfo();
      expect(info.enabled).toBe(true);
      expect(info.ready).toBe(true);
      expect(info.totalIps).toBe(3);
      expect(info.lastUpdate).toEqual(MTIME);
      expect(info.path).toContain('netapi');
    });

    it('carries the CC BY 4.0 attribution', () => {
      expect(NETAPI_ATTRIBUTION.license).toBe('CC BY 4.0');
      expect(NETAPI_ATTRIBUTION.url).toBe('https://netapi.com/compromised-ips/');
    });
  });
});
