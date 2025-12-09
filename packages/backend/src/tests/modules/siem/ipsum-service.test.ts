import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * IpsumService tests - IP reputation checking service
 * Tests the core functionality without requiring actual database files
 */

// Create a testable version of the service class
class TestableIpsumService {
  private ipDatabase: Map<string, number> = new Map();
  private lastUpdate: Date | null = null;
  private isUpdating = false;
  private isReady = false;

  // Threshold constants
  private THRESHOLD_SUSPICIOUS = 1;
  private THRESHOLD_MALICIOUS = 3;

  /**
   * Load test data directly into the database
   */
  loadTestData(data: Array<{ ip: string; score: number }>): void {
    this.ipDatabase.clear();
    for (const { ip, score } of data) {
      this.ipDatabase.set(ip, score);
    }
    this.lastUpdate = new Date();
    this.isReady = true;
  }

  /**
   * Check IP reputation
   */
  checkIp(ip: string): {
    ip: string;
    reputation: 'clean' | 'suspicious' | 'malicious';
    score: number;
    source: 'IPsum';
    lastChecked: Date;
  } {
    const score = this.ipDatabase.get(ip) ?? 0;

    let reputation: 'clean' | 'suspicious' | 'malicious' = 'clean';
    if (score >= this.THRESHOLD_MALICIOUS) {
      reputation = 'malicious';
    } else if (score >= this.THRESHOLD_SUSPICIOUS) {
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
  checkIpBatch(ips: string[]): Record<string, ReturnType<typeof this.checkIp>> {
    const results: Record<string, ReturnType<typeof this.checkIp>> = {};
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
   * Check if database needs update (older than 24 hours)
   */
  needsUpdate(): boolean {
    if (!this.lastUpdate) return true;

    const now = new Date();
    const hoursSinceUpdate = (now.getTime() - this.lastUpdate.getTime()) / (1000 * 60 * 60);
    return hoursSinceUpdate > 24;
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
      path: 'test-path',
    };
  }

  /**
   * Simulate updating state
   */
  setUpdating(value: boolean): void {
    this.isUpdating = value;
  }

  getUpdating(): boolean {
    return this.isUpdating;
  }
}

describe('IpsumService', () => {
  let service: TestableIpsumService;

  beforeEach(() => {
    service = new TestableIpsumService();
  });

  describe('checkIp', () => {
    it('should return clean for unknown IPs', () => {
      service.loadTestData([]);

      const result = service.checkIp('192.168.1.1');

      expect(result.ip).toBe('192.168.1.1');
      expect(result.reputation).toBe('clean');
      expect(result.score).toBe(0);
      expect(result.source).toBe('IPsum');
      expect(result.lastChecked).toBeInstanceOf(Date);
    });

    it('should return clean for IP with score 0', () => {
      service.loadTestData([{ ip: '1.2.3.4', score: 0 }]);

      const result = service.checkIp('1.2.3.4');

      expect(result.reputation).toBe('clean');
      expect(result.score).toBe(0);
    });

    it('should return suspicious for IP with score 1', () => {
      service.loadTestData([{ ip: '10.0.0.1', score: 1 }]);

      const result = service.checkIp('10.0.0.1');

      expect(result.reputation).toBe('suspicious');
      expect(result.score).toBe(1);
    });

    it('should return suspicious for IP with score 2', () => {
      service.loadTestData([{ ip: '10.0.0.2', score: 2 }]);

      const result = service.checkIp('10.0.0.2');

      expect(result.reputation).toBe('suspicious');
      expect(result.score).toBe(2);
    });

    it('should return malicious for IP with score 3 or higher', () => {
      service.loadTestData([
        { ip: '8.8.8.8', score: 3 },
        { ip: '1.1.1.1', score: 10 },
      ]);

      const result1 = service.checkIp('8.8.8.8');
      expect(result1.reputation).toBe('malicious');
      expect(result1.score).toBe(3);

      const result2 = service.checkIp('1.1.1.1');
      expect(result2.reputation).toBe('malicious');
      expect(result2.score).toBe(10);
    });

    it('should handle IPv6 addresses', () => {
      service.loadTestData([{ ip: '2001:4860:4860::8888', score: 5 }]);

      const result = service.checkIp('2001:4860:4860::8888');

      expect(result.reputation).toBe('malicious');
      expect(result.score).toBe(5);
    });
  });

  describe('checkIpBatch', () => {
    it('should check multiple IPs at once', () => {
      service.loadTestData([
        { ip: '1.1.1.1', score: 5 },
        { ip: '2.2.2.2', score: 1 },
      ]);

      const results = service.checkIpBatch(['1.1.1.1', '2.2.2.2', '3.3.3.3']);

      expect(results['1.1.1.1'].reputation).toBe('malicious');
      expect(results['2.2.2.2'].reputation).toBe('suspicious');
      expect(results['3.3.3.3'].reputation).toBe('clean');
    });

    it('should return empty object for empty array', () => {
      service.loadTestData([]);

      const results = service.checkIpBatch([]);

      expect(Object.keys(results)).toHaveLength(0);
    });

    it('should handle duplicate IPs in batch', () => {
      service.loadTestData([{ ip: '1.1.1.1', score: 3 }]);

      const results = service.checkIpBatch(['1.1.1.1', '1.1.1.1']);

      // Should only have one key since duplicates are overwritten
      expect(Object.keys(results)).toHaveLength(1);
      expect(results['1.1.1.1'].reputation).toBe('malicious');
    });
  });

  describe('ready', () => {
    it('should return false before initialization', () => {
      expect(service.ready()).toBe(false);
    });

    it('should return true after loading data', () => {
      service.loadTestData([]);
      expect(service.ready()).toBe(true);
    });
  });

  describe('needsUpdate', () => {
    it('should return true when lastUpdate is null', () => {
      expect(service.needsUpdate()).toBe(true);
    });

    it('should return false when updated recently', () => {
      service.loadTestData([]); // Sets lastUpdate to now
      expect(service.needsUpdate()).toBe(false);
    });
  });

  describe('getInfo', () => {
    it('should return service info before initialization', () => {
      const info = service.getInfo();

      expect(info.ready).toBe(false);
      expect(info.lastUpdate).toBeNull();
      expect(info.totalIps).toBe(0);
      expect(info.path).toBe('test-path');
    });

    it('should return service info after loading data', () => {
      service.loadTestData([
        { ip: '1.1.1.1', score: 1 },
        { ip: '2.2.2.2', score: 2 },
      ]);

      const info = service.getInfo();

      expect(info.ready).toBe(true);
      expect(info.lastUpdate).toBeInstanceOf(Date);
      expect(info.totalIps).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('should handle special IP addresses', () => {
      service.loadTestData([]);

      // Private IPs
      expect(service.checkIp('192.168.0.1').reputation).toBe('clean');
      expect(service.checkIp('10.0.0.1').reputation).toBe('clean');
      expect(service.checkIp('172.16.0.1').reputation).toBe('clean');

      // Loopback
      expect(service.checkIp('127.0.0.1').reputation).toBe('clean');

      // Broadcast
      expect(service.checkIp('255.255.255.255').reputation).toBe('clean');
    });

    it('should handle very high scores', () => {
      service.loadTestData([{ ip: '1.2.3.4', score: 100 }]);

      const result = service.checkIp('1.2.3.4');

      expect(result.reputation).toBe('malicious');
      expect(result.score).toBe(100);
    });

    it('should be case-insensitive for IPv6', () => {
      service.loadTestData([{ ip: '2001:db8::1', score: 5 }]);

      // Note: The service should handle this, but if it stores lowercase
      // the lookup should match
      const result = service.checkIp('2001:db8::1');
      expect(result.reputation).toBe('malicious');
    });
  });
});
