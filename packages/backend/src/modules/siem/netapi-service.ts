import fs from 'fs';
import net from 'net';
import path from 'path';
import { config } from '../../config/index.js';

// NetAPI honeypot attackers list
// Source: https://netapi.com/compromised-ips/ (CC BY 4.0, attribution "NetAPI")
// IPv4 addresses that attacked NetAPI's own honeypot sensors in the last 48 hours,
// rebuilt every hour. Plain text: a "#" comment line, then one address per line.
const NETAPI_DATA_DIR = path.join(process.cwd(), 'data', 'netapi');
const NETAPI_FILE_PATH = path.join(NETAPI_DATA_DIR, 'netapi.txt');
const NETAPI_DOWNLOAD_URL = 'https://netapi.com/api2/?method=compromised&dataset_type=ip';

// The list changes every hour; a refresh is a conditional request (If-Modified-Since),
// so an unchanged list costs a 304 and no download.
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

// The API server and the worker each hold their own copy in memory, and only the worker
// refreshes the file: a lookup re-reads it when its mtime changed, checked at most this often.
const RELOAD_CHECK_INTERVAL_MS = 60 * 1000;

// Shown next to every hit, as the CC BY 4.0 licence asks.
export const NETAPI_ATTRIBUTION = {
  name: 'NetAPI honeypot feed',
  license: 'CC BY 4.0',
  url: 'https://netapi.com/compromised-ips/',
} as const;

export interface NetapiReputationResult {
  ip: string;
  listed: boolean;
  source: 'NetAPI';
  lastChecked: Date;
}

class NetapiReputationService {
  private ipDatabase: Set<string> = new Set();
  private lastUpdate: Date | null = null; // mtime of the file in memory
  private lastCheck: Date | null = null; // last successful refresh (200 or 304)
  private lastReloadCheck = 0;
  private isUpdating = false;
  private isReady = false;

  /**
   * Whether the source is turned on (NETAPI_REPUTATION_ENABLED, default true)
   */
  enabled(): boolean {
    return config.NETAPI_REPUTATION_ENABLED;
  }

  /**
   * Initialize: download the list if it is missing, load it into memory
   */
  async initialize(): Promise<boolean> {
    if (!this.enabled()) {
      console.log('[NetAPI] Disabled (NETAPI_REPUTATION_ENABLED=false)');
      return false;
    }

    console.log('[NetAPI] Initializing...');

    if (!fs.existsSync(NETAPI_DATA_DIR)) {
      fs.mkdirSync(NETAPI_DATA_DIR, { recursive: true });
      console.log('[NetAPI] Created data directory:', NETAPI_DATA_DIR);
    }

    if (!fs.existsSync(NETAPI_FILE_PATH)) {
      console.log('[NetAPI] List not found, downloading...');
      const success = await this.downloadDatabase();
      if (!success) {
        console.error('[NetAPI] Failed to download list');
        return false;
      }
      return true;
    }

    return this.loadDatabase();
  }

  /**
   * Parse the list: "#" lines and anything that is not an IPv4 address are skipped
   */
  private parse(content: string): Set<string> {
    const ips = new Set<string>();
    for (const line of content.split('\n')) {
      const ip = line.trim();
      if (!ip || ip.startsWith('#')) continue;
      if (net.isIPv4(ip)) ips.add(ip);
    }
    return ips;
  }

  /**
   * Load the list file into memory
   */
  private loadDatabase(): boolean {
    try {
      if (!fs.existsSync(NETAPI_FILE_PATH)) {
        console.error('[NetAPI] List file not found:', NETAPI_FILE_PATH);
        return false;
      }

      this.ipDatabase = this.parse(fs.readFileSync(NETAPI_FILE_PATH, 'utf-8'));
      this.lastUpdate = fs.statSync(NETAPI_FILE_PATH).mtime;
      this.lastReloadCheck = Date.now();
      this.isReady = true;

      console.log(`[NetAPI] Loaded ${this.ipDatabase.size.toLocaleString()} attacking IPs`);
      return true;
    } catch (error) {
      console.error('[NetAPI] Failed to load list:', error);
      return false;
    }
  }

  /**
   * Re-read the file when another process (the worker) replaced it
   */
  private reloadIfChanged(): void {
    const now = Date.now();
    if (now - this.lastReloadCheck < RELOAD_CHECK_INTERVAL_MS) return;
    this.lastReloadCheck = now;
    try {
      if (!fs.existsSync(NETAPI_FILE_PATH)) return;
      const mtime = fs.statSync(NETAPI_FILE_PATH).mtime;
      if (!this.lastUpdate || mtime.getTime() !== this.lastUpdate.getTime()) {
        this.loadDatabase();
      }
    } catch (error) {
      console.error('[NetAPI] Failed to check list file:', error);
    }
  }

  /**
   * Download the list; with a file on disk the request is conditional (If-Modified-Since)
   */
  async downloadDatabase(): Promise<boolean> {
    if (!this.enabled()) return false;

    if (this.isUpdating) {
      console.log('[NetAPI] Update already in progress, skipping...');
      return false;
    }

    this.isUpdating = true;
    // per-process temp name: the API server and the worker may both download at startup
    const tempPath = path.join(NETAPI_DATA_DIR, `netapi.${process.pid}.tmp`);

    try {
      const headers: Record<string, string> = { 'User-Agent': 'LogTide/1.0' };
      if (fs.existsSync(NETAPI_FILE_PATH)) {
        headers['If-Modified-Since'] = fs.statSync(NETAPI_FILE_PATH).mtime.toUTCString();
      }

      const response = await fetch(NETAPI_DOWNLOAD_URL, { headers });

      if (response.status === 304) {
        this.lastCheck = new Date();
        if (!this.isReady) this.loadDatabase();
        console.log('[NetAPI] List not modified');
        return true;
      }

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      const content = await response.text();
      // an error page or an empty answer must not replace a good list
      if (this.parse(content).size === 0) {
        throw new Error('Download contained no IPv4 addresses');
      }

      fs.mkdirSync(NETAPI_DATA_DIR, { recursive: true });
      fs.writeFileSync(tempPath, content, 'utf-8');
      fs.renameSync(tempPath, NETAPI_FILE_PATH);

      // give the file the server's Last-Modified as mtime, so the next If-Modified-Since
      // echoes the server's own timestamp and does not depend on the local clock
      const lastModified = response.headers?.get?.('last-modified');
      const lastModifiedDate = lastModified ? new Date(lastModified) : null;
      if (lastModifiedDate && !Number.isNaN(lastModifiedDate.getTime())) {
        try {
          fs.utimesSync(NETAPI_FILE_PATH, lastModifiedDate, lastModifiedDate);
        } catch (error) {
          console.warn('[NetAPI] Could not set list file mtime:', error);
        }
      }

      const sizeKB = (Buffer.byteLength(content, 'utf-8') / 1024).toFixed(2);
      console.log(`[NetAPI] Downloaded ${sizeKB} KB`);

      this.lastCheck = new Date();
      return this.loadDatabase();
    } catch (error) {
      console.error('[NetAPI] Download failed:', error);

      if (fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { force: true });
      }

      return false;
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Whether the list is due for a refresh (hourly)
   */
  needsUpdate(): boolean {
    if (!this.enabled()) return false;
    if (!this.lastCheck) return true;
    return Date.now() - this.lastCheck.getTime() >= REFRESH_INTERVAL_MS;
  }

  /**
   * Check whether an IP is on the list
   */
  checkIp(ip: string): NetapiReputationResult {
    this.reloadIfChanged();
    return {
      ip,
      listed: this.ipDatabase.has(ip),
      source: 'NetAPI',
      lastChecked: new Date(),
    };
  }

  /**
   * Whether the list is loaded and the source is turned on
   */
  ready(): boolean {
    if (!this.enabled()) return false;
    // a process whose own download failed (e.g. the API server at startup) picks up
    // the file once the worker has written it
    if (!this.isReady) this.reloadIfChanged();
    return this.isReady;
  }

  /**
   * List info for the status endpoints
   */
  getInfo(): {
    enabled: boolean;
    ready: boolean;
    lastUpdate: Date | null;
    totalIps: number;
    path: string;
  } {
    return {
      enabled: this.enabled(),
      ready: this.ready(),
      lastUpdate: this.lastUpdate,
      totalIps: this.ipDatabase.size,
      path: NETAPI_FILE_PATH,
    };
  }
}

// Singleton instance
export const netapiReputationService = new NetapiReputationService();
