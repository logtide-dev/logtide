import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/logs', () => ({ logsAPI: { createLogsWebSocket: vi.fn() } }));

import { getAllPanelDefinitions, getPanelDefinition, createPanelInstance } from './panel-registry';

// Sentence case: the first word may be capitalised, no other word is, except
// the standalone "N" in "Top N table".
function isSentenceCase(text: string): boolean {
  const words = text.split(/\s+/).slice(1);
  return words.every((w) => w === 'N' || !/^[A-Z]/.test(w));
}

describe('panel registry labels', () => {
  it('time_series label is Log volume', () => {
    expect(getPanelDefinition('time_series').label).toBe('Log volume');
    expect(getPanelDefinition('time_series').type).toBe('time_series');
  });

  it('all labels and default titles are sentence case', () => {
    for (const def of getAllPanelDefinitions()) {
      expect(isSentenceCase(def.label), `label ${def.label}`).toBe(true);
      expect(isSentenceCase(def.defaultConfig.title), `title ${def.defaultConfig.title}`).toBe(
        true
      );
    }
  });
});

describe('panel registry metrics and legacy types', () => {
  it('offers the metrics panel and not the legacy metric panels', () => {
    const types = getAllPanelDefinitions().map((d) => d.type) as string[];
    expect(types).toContain('metrics');
    expect(types).not.toContain('metric_chart');
    expect(types).not.toContain('metric_stat');
  });

  it('creates a metrics panel with an empty query', () => {
    const panel = createPanelInstance('metrics');
    expect(panel.config.type).toBe('metrics');
  });

  it.each(['metric_chart', 'metric_stat'] as const)('%s resolves to the legacy fallback', (type) => {
    const def = getPanelDefinition(type);
    expect(def.label).toBe('Legacy panel');
    expect(def.description).toBe('Legacy panel, open and save to upgrade.');
  });
});
