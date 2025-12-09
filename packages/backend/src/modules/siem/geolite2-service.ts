import fs from 'fs';
import path from 'path';
import { Reader, type ReaderModel } from '@maxmind/geoip2-node';

// GeoLite2 database configuration
const GEOLITE2_DB_DIR = path.join(process.cwd(), 'data', 'geolite2');
const GEOLITE2_DB_PATH = path.join(GEOLITE2_DB_DIR, 'GeoLite2-City.mmdb');

// GitHub mirror - no license key required
// Updated weekly by P3TERX
const GEOLITE2_DOWNLOAD_URL =
  'https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-City.mmdb';

export interface GeoLite2Data {
  ip: string;
  country: string;
  countryCode: string;
  city: string | null;
  latitude: number;
  longitude: number;
  timezone: string | null;
  accuracy: number | null;
  subdivision: string | null;
  postalCode: string | null;
}

class GeoLite2Service {
  private reader: ReaderModel | null = null;
  private lastUpdate: Date | null = null;
  private isUpdating = false;

  /**
   * Initialize the GeoLite2 database
   * Downloads if missing, loads into memory
   */
  async initialize(): Promise<boolean> {
    console.log('[GeoLite2] Initializing...');

    // Create data directory if it doesn't exist
    if (!fs.existsSync(GEOLITE2_DB_DIR)) {
      fs.mkdirSync(GEOLITE2_DB_DIR, { recursive: true });
      console.log('[GeoLite2] Created data directory:', GEOLITE2_DB_DIR);
    }

    // Check if database exists
    if (!fs.existsSync(GEOLITE2_DB_PATH)) {
      console.log('[GeoLite2] Database not found, downloading...');
      const success = await this.downloadDatabase();
      if (!success) {
        console.error('[GeoLite2] Failed to download database');
        return false;
      }
    }

    // Load the database
    return this.loadDatabase();
  }

  /**
   * Load the database into memory
   */
  private async loadDatabase(): Promise<boolean> {
    try {
      if (!fs.existsSync(GEOLITE2_DB_PATH)) {
        console.error('[GeoLite2] Database file not found:', GEOLITE2_DB_PATH);
        return false;
      }

      this.reader = await Reader.open(GEOLITE2_DB_PATH);
      this.lastUpdate = fs.statSync(GEOLITE2_DB_PATH).mtime;
      console.log('[GeoLite2] Database loaded successfully');
      console.log('[GeoLite2] Last update:', this.lastUpdate.toISOString());
      return true;
    } catch (error) {
      console.error('[GeoLite2] Failed to load database:', error);
      return false;
    }
  }

  /**
   * Download the GeoLite2 database from GitHub mirror
   * No license key required
   */
  async downloadDatabase(): Promise<boolean> {
    if (this.isUpdating) {
      console.log('[GeoLite2] Update already in progress, skipping...');
      return false;
    }

    this.isUpdating = true;
    const tempPath = path.join(GEOLITE2_DB_DIR, 'temp.mmdb');

    try {
      console.log('[GeoLite2] Downloading database from GitHub mirror...');

      const response = await fetch(GEOLITE2_DOWNLOAD_URL, {
        headers: {
          'User-Agent': 'LogWard/1.0',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      // Save to temp file
      const body = response.body;
      if (!body) {
        throw new Error('No response body');
      }

      // Convert web stream to buffer
      const webReader = body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await webReader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.length;
      }

      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(tempPath, buffer);
      console.log(`[GeoLite2] Downloaded ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

      // Move temp file to final location
      fs.renameSync(tempPath, GEOLITE2_DB_PATH);
      console.log('[GeoLite2] Database saved successfully');

      // Reload the database
      await this.loadDatabase();

      console.log('[GeoLite2] Update completed successfully');
      return true;
    } catch (error) {
      console.error('[GeoLite2] Download failed:', error);

      // Cleanup on error
      if (fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { force: true });
      }

      return false;
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Check if database needs update (older than 24 hours)
   */
  needsUpdate(): boolean {
    if (!this.lastUpdate) return true;

    const now = new Date();
    const hoursSinceUpdate = (now.getTime() - this.lastUpdate.getTime()) / (1000 * 60 * 60);
    return hoursSinceUpdate > 24;
  }

  /**
   * Lookup IP address in the GeoLite2 database
   */
  lookup(ip: string): GeoLite2Data | null {
    if (!this.reader) {
      console.warn('[GeoLite2] Database not loaded');
      return null;
    }

    try {
      const result = this.reader.city(ip);

      return {
        ip,
        country: result.country?.names?.en ?? 'Unknown',
        countryCode: result.country?.isoCode ?? 'XX',
        city: result.city?.names?.en ?? null,
        latitude: result.location?.latitude ?? 0,
        longitude: result.location?.longitude ?? 0,
        timezone: result.location?.timeZone ?? null,
        accuracy: result.location?.accuracyRadius ?? null,
        subdivision: result.subdivisions?.[0]?.names?.en ?? null,
        postalCode: result.postal?.code ?? null,
      };
    } catch {
      // IP not found in database (e.g., private IP, invalid IP)
      return null;
    }
  }

  /**
   * Batch lookup for multiple IPs
   */
  lookupBatch(ips: string[]): Record<string, GeoLite2Data | null> {
    const results: Record<string, GeoLite2Data | null> = {};
    for (const ip of ips) {
      results[ip] = this.lookup(ip);
    }
    return results;
  }

  /**
   * Check if the service is ready
   */
  isReady(): boolean {
    return this.reader !== null;
  }

  /**
   * Get database info
   */
  getInfo(): {
    ready: boolean;
    lastUpdate: Date | null;
    path: string;
  } {
    return {
      ready: this.isReady(),
      lastUpdate: this.lastUpdate,
      path: GEOLITE2_DB_PATH,
    };
  }
}

// Singleton instance
export const geoLite2Service = new GeoLite2Service();
