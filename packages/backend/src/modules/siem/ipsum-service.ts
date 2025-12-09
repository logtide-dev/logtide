import fs from 'fs';
import path from 'path';

// IPsum configuration
// Source: https://github.com/stamparm/ipsum
// Daily updated threat intelligence from 30+ blacklists
const IPSUM_DATA_DIR = path.join(process.cwd(), 'data', 'ipsum');
const IPSUM_FILE_PATH = path.join(IPSUM_DATA_DIR, 'ipsum.txt');
const IPSUM_DOWNLOAD_URL = 'https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt';

// Score thresholds for reputation classification
// Score = number of blacklists an IP appears on
const THRESHOLD_SUSPICIOUS = 1; // 1-2 blacklists = suspicious
const THRESHOLD_MALICIOUS = 3; // 3+ blacklists = malicious

export interface IpReputationResult {
  ip: string;
  reputation: 'clean' | 'suspicious' | 'malicious';
  score: number; // Number of blacklists the IP appears on
  source: 'IPsum';
  lastChecked: Date;
}

class IpsumService {
  private ipDatabase: Map<string, number> = new Map();
  private lastUpdate: Date | null = null;
  private isUpdating = false;
  private isReady = false;

  /**
   * Initialize the IPsum database
   * Downloads if missing, loads into memory
   */
  async initialize(): Promise<boolean> {
    console.log('[IPsum] Initializing...');

    // Create data directory if it doesn't exist
    if (!fs.existsSync(IPSUM_DATA_DIR)) {
      fs.mkdirSync(IPSUM_DATA_DIR, { recursive: true });
      console.log('[IPsum] Created data directory:', IPSUM_DATA_DIR);
    }

    // Check if database exists
    if (!fs.existsSync(IPSUM_FILE_PATH)) {
      console.log('[IPsum] Database not found, downloading...');
      const success = await this.downloadDatabase();
      if (!success) {
        console.error('[IPsum] Failed to download database');
        return false;
      }
    }

    // Load the database
    return this.loadDatabase();
  }

  /**
   * Load the IPsum list into memory
   */
  private loadDatabase(): boolean {
    try {
      if (!fs.existsSync(IPSUM_FILE_PATH)) {
        console.error('[IPsum] Database file not found:', IPSUM_FILE_PATH);
        return false;
      }

      const content = fs.readFileSync(IPSUM_FILE_PATH, 'utf-8');
      const lines = content.split('\n');

      this.ipDatabase.clear();
      let count = 0;

      for (const line of lines) {
        // Skip comments and empty lines
        if (line.startsWith('#') || !line.trim()) continue;

        // Format: IP<tab>score
        const parts = line.split('\t');
        if (parts.length >= 2) {
          const ip = parts[0].trim();
          const score = parseInt(parts[1].trim(), 10);
          if (ip && !isNaN(score)) {
            this.ipDatabase.set(ip, score);
            count++;
          }
        }
      }

      this.lastUpdate = fs.statSync(IPSUM_FILE_PATH).mtime;
      this.isReady = true;

      console.log(`[IPsum] Loaded ${count.toLocaleString()} malicious IPs`);
      console.log('[IPsum] Last update:', this.lastUpdate.toISOString());
      return true;
    } catch (error) {
      console.error('[IPsum] Failed to load database:', error);
      return false;
    }
  }

  /**
   * Download the IPsum database from GitHub
   */
  async downloadDatabase(): Promise<boolean> {
    if (this.isUpdating) {
      console.log('[IPsum] Update already in progress, skipping...');
      return false;
    }

    this.isUpdating = true;
    const tempPath = path.join(IPSUM_DATA_DIR, 'ipsum.tmp');

    try {
      console.log('[IPsum] Downloading database from GitHub...');

      const response = await fetch(IPSUM_DOWNLOAD_URL, {
        headers: {
          'User-Agent': 'LogWard/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      const content = await response.text();
      fs.writeFileSync(tempPath, content, 'utf-8');

      const sizeKB = (Buffer.byteLength(content, 'utf-8') / 1024).toFixed(2);
      console.log(`[IPsum] Downloaded ${sizeKB} KB`);

      // Move temp file to final location
      fs.renameSync(tempPath, IPSUM_FILE_PATH);
      console.log('[IPsum] Database saved successfully');

      // Reload the database
      this.loadDatabase();

      console.log('[IPsum] Update completed successfully');
      return true;
    } catch (error) {
      console.error('[IPsum] Download failed:', error);

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
   * Check IP reputation
   * Returns reputation based on how many blacklists the IP appears on
   */
  checkIp(ip: string): IpReputationResult {
    const score = this.ipDatabase.get(ip) ?? 0;

    let reputation: 'clean' | 'suspicious' | 'malicious' = 'clean';
    if (score >= THRESHOLD_MALICIOUS) {
      reputation = 'malicious';
    } else if (score >= THRESHOLD_SUSPICIOUS) {
      reputation = 'suspicious';
    }

    return {
      ip,
      reputation,
      score,
      source: 'IPsum',
      lastChecked: new Date(),
    };
  }

  /**
   * Batch check multiple IPs
   */
  checkIpBatch(ips: string[]): Record<string, IpReputationResult> {
    const results: Record<string, IpReputationResult> = {};
    for (const ip of ips) {
      results[ip] = this.checkIp(ip);
    }
    return results;
  }

  /**
   * Check if the service is ready
   */
  ready(): boolean {
    return this.isReady;
  }

  /**
   * Get database info
   */
  getInfo(): {
    ready: boolean;
    lastUpdate: Date | null;
    totalIps: number;
    path: string;
  } {
    return {
      ready: this.isReady,
      lastUpdate: this.lastUpdate,
      totalIps: this.ipDatabase.size,
      path: IPSUM_FILE_PATH,
    };
  }
}

// Singleton instance
export const ipsumService = new IpsumService();
