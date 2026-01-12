import { describe, it, expect } from 'vitest';
import {
  mapSeverityToLevel,
  levelToSeverityNumber,
  type LogTideLevel,
} from '../../../modules/otlp/severity-mapper.js';

describe('OTLP Severity Mapper', () => {
  describe('mapSeverityToLevel', () => {
    describe('by severity number', () => {
      it('should map UNSPECIFIED (0) to info', () => {
        expect(mapSeverityToLevel(0)).toBe('info');
      });

      it('should map undefined to info', () => {
        expect(mapSeverityToLevel()).toBe('info');
        expect(mapSeverityToLevel(undefined)).toBe('info');
      });

      it('should map TRACE (1-4) to debug', () => {
        expect(mapSeverityToLevel(1)).toBe('debug');
        expect(mapSeverityToLevel(2)).toBe('debug');
        expect(mapSeverityToLevel(3)).toBe('debug');
        expect(mapSeverityToLevel(4)).toBe('debug');
      });

      it('should map DEBUG (5-8) to debug', () => {
        expect(mapSeverityToLevel(5)).toBe('debug');
        expect(mapSeverityToLevel(6)).toBe('debug');
        expect(mapSeverityToLevel(7)).toBe('debug');
        expect(mapSeverityToLevel(8)).toBe('debug');
      });

      it('should map INFO (9-12) to info', () => {
        expect(mapSeverityToLevel(9)).toBe('info');
        expect(mapSeverityToLevel(10)).toBe('info');
        expect(mapSeverityToLevel(11)).toBe('info');
        expect(mapSeverityToLevel(12)).toBe('info');
      });

      it('should map WARN (13-16) to warn', () => {
        expect(mapSeverityToLevel(13)).toBe('warn');
        expect(mapSeverityToLevel(14)).toBe('warn');
        expect(mapSeverityToLevel(15)).toBe('warn');
        expect(mapSeverityToLevel(16)).toBe('warn');
      });

      it('should map ERROR (17-20) to error', () => {
        expect(mapSeverityToLevel(17)).toBe('error');
        expect(mapSeverityToLevel(18)).toBe('error');
        expect(mapSeverityToLevel(19)).toBe('error');
        expect(mapSeverityToLevel(20)).toBe('error');
      });

      it('should map FATAL (21-24) to critical', () => {
        expect(mapSeverityToLevel(21)).toBe('critical');
        expect(mapSeverityToLevel(22)).toBe('critical');
        expect(mapSeverityToLevel(23)).toBe('critical');
        expect(mapSeverityToLevel(24)).toBe('critical');
      });

      it('should handle out of range values', () => {
        // Negative values should map to info (same as 0)
        expect(mapSeverityToLevel(-1)).toBe('info');

        // Values > 24 should still map to critical
        expect(mapSeverityToLevel(25)).toBe('critical');
        expect(mapSeverityToLevel(100)).toBe('critical');
      });
    });

    describe('by severity text', () => {
      it('should map TRACE text to debug', () => {
        expect(mapSeverityToLevel(0, 'TRACE')).toBe('debug');
        expect(mapSeverityToLevel(0, 'trace')).toBe('debug');
        expect(mapSeverityToLevel(0, 'TRACE4')).toBe('debug');
      });

      it('should map DEBUG text to debug', () => {
        expect(mapSeverityToLevel(0, 'DEBUG')).toBe('debug');
        expect(mapSeverityToLevel(0, 'debug')).toBe('debug');
        expect(mapSeverityToLevel(0, 'Debug')).toBe('debug');
      });

      it('should map INFO text to info', () => {
        expect(mapSeverityToLevel(0, 'INFO')).toBe('info');
        expect(mapSeverityToLevel(0, 'info')).toBe('info');
        expect(mapSeverityToLevel(0, 'INFORMATION')).toBe('info');
      });

      it('should map WARN text to warn', () => {
        expect(mapSeverityToLevel(0, 'WARN')).toBe('warn');
        expect(mapSeverityToLevel(0, 'warn')).toBe('warn');
        expect(mapSeverityToLevel(0, 'WARNING')).toBe('warn');
      });

      it('should map ERROR text to error', () => {
        expect(mapSeverityToLevel(0, 'ERROR')).toBe('error');
        expect(mapSeverityToLevel(0, 'error')).toBe('error');
        expect(mapSeverityToLevel(0, 'Error')).toBe('error');
      });

      it('should map FATAL text to critical', () => {
        expect(mapSeverityToLevel(0, 'FATAL')).toBe('critical');
        expect(mapSeverityToLevel(0, 'fatal')).toBe('critical');
        expect(mapSeverityToLevel(0, 'FATAL4')).toBe('critical');
      });

      it('should map CRITICAL text to critical', () => {
        expect(mapSeverityToLevel(0, 'CRITICAL')).toBe('critical');
        expect(mapSeverityToLevel(0, 'critical')).toBe('critical');
      });

      it('should prefer text over number when text is provided', () => {
        // Even with INFO number, ERROR text should win
        expect(mapSeverityToLevel(9, 'ERROR')).toBe('error');
        // Even with FATAL number, DEBUG text should win
        expect(mapSeverityToLevel(21, 'DEBUG')).toBe('debug');
      });

      it('should fall back to number if text is unknown', () => {
        expect(mapSeverityToLevel(17, 'UNKNOWN')).toBe('error');
        expect(mapSeverityToLevel(13, 'CUSTOM')).toBe('warn');
      });

      it('should fall back to number if text is empty', () => {
        expect(mapSeverityToLevel(17, '')).toBe('error');
      });
    });
  });

  describe('levelToSeverityNumber', () => {
    it('should map debug to DEBUG (5)', () => {
      expect(levelToSeverityNumber('debug')).toBe(5);
    });

    it('should map info to INFO (9)', () => {
      expect(levelToSeverityNumber('info')).toBe(9);
    });

    it('should map warn to WARN (13)', () => {
      expect(levelToSeverityNumber('warn')).toBe(13);
    });

    it('should map error to ERROR (17)', () => {
      expect(levelToSeverityNumber('error')).toBe(17);
    });

    it('should map critical to FATAL (21)', () => {
      expect(levelToSeverityNumber('critical')).toBe(21);
    });

    it('should be consistent with mapSeverityToLevel', () => {
      const levels: LogTideLevel[] = ['debug', 'info', 'warn', 'error', 'critical'];

      for (const level of levels) {
        const severityNumber = levelToSeverityNumber(level);
        const mappedBack = mapSeverityToLevel(severityNumber);
        expect(mappedBack).toBe(level);
      }
    });
  });
});
