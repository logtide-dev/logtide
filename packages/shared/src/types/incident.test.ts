import { describe, it, expect } from 'vitest';
import {
  INCIDENT_ACTIVE_STATUSES,
  INCIDENT_BULK_ACTIONS,
  INCIDENT_BULK_MAX_IDS,
  INCIDENT_SORT_KEYS,
} from './incident.js';
import { INCIDENT_SOURCES, type IncidentSource } from '../constants/monitoring-constants.js';
import { getIncidentSourceLabel, getIncidentStatusLabel } from '../utils/severity.js';
import * as shared from '../index.js';

describe('incident types', () => {
  it('lists alert as an incident source', () => {
    expect(INCIDENT_SOURCES).toEqual(['sigma', 'alert', 'monitor', 'manual']);
  });

  it('treats open and investigating as active', () => {
    expect(INCIDENT_ACTIVE_STATUSES).toEqual(['open', 'investigating']);
  });

  it('labels investigating as Acknowledged in sentence case', () => {
    expect(getIncidentStatusLabel('open')).toBe('Open');
    expect(getIncidentStatusLabel('investigating')).toBe('Acknowledged');
    expect(getIncidentStatusLabel('resolved')).toBe('Resolved');
    expect(getIncidentStatusLabel('false_positive')).toBe('False positive');
  });

  it('labels sources', () => {
    expect(
      ['sigma', 'alert', 'monitor', 'manual'].map((s) => getIncidentSourceLabel(s as IncidentSource))
    ).toEqual(['Security', 'Alert', 'Uptime', 'Manual']);
  });

  it('caps bulk at 100 ids', () => expect(INCIDENT_BULK_MAX_IDS).toBe(100));

  it('exposes sort keys and bulk actions', () => {
    expect(INCIDENT_SORT_KEYS).toEqual(['last_event_at', 'created_at', 'severity']);
    expect(INCIDENT_BULK_ACTIONS).toEqual(['acknowledge', 'resolve', 'assign']);
  });

  it('is re-exported from the package root', () => {
    expect(shared.INCIDENT_ACTIVE_STATUSES).toBe(INCIDENT_ACTIVE_STATUSES);
    expect(shared.INCIDENT_BULK_MAX_IDS).toBe(100);
    expect(typeof shared.getIncidentSourceLabel).toBe('function');
  });
});
