import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/logs', () => ({ logsAPI: { createLogsWebSocket: vi.fn() } }));

import { getAllPanelDefinitions, getPanelDefinition } from './panel-registry';

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
