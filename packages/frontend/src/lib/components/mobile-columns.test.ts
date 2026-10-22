import { describe, it, expect } from 'vitest';
import incidents from './siem/incidents/IncidentsTable.svelte?raw';
import alerts from './alerts/AlertRulesTable.svelte?raw';
import monitors from './monitoring/MonitorList.svelte?raw';
import channels from './notification-channels/ChannelsList.svelte?raw';

// At 390 px the primary column must stay readable: secondary columns hide
// below the breakpoint and the primary column has a minimum width.
describe('mobile table columns', () => {
  it('incidents hides secondary columns and keeps a title width', () => {
    expect(incidents).toMatch(/key: 'title'[^\n]*min-w-\[11rem\]/);
    for (const k of ['source', 'project', 'assignee', 'age', 'lastEvent']) {
      expect(incidents).toMatch(new RegExp(`key: '${k}'[^\n]*hidden md:table-cell`));
    }
  });
  it('incidents keeps project, age and last event on one line', () => {
    for (const k of ['project', 'age', 'lastEvent']) {
      expect(incidents).toMatch(new RegExp(`key: '${k}'[^\n]*whitespace-nowrap`));
    }
  });
  it('alerts hides the wide columns below lg', () => {
    for (const k of ['lastTriggered', 'triggers', 'notify']) {
      expect(alerts).toMatch(new RegExp(`key: '${k}'[^\n]*hidden[^\n]*lg:table-cell`));
    }
  });
  it('monitors and destinations give the name a min width and hide extras', () => {
    expect(monitors).toMatch(/key: 'name'[^\n]*min-w-\[9rem\]/);
    expect(monitors).toMatch(/key: 'type'[^\n]*hidden sm:table-cell/);
    expect(channels).toMatch(/key: 'name'[^\n]*min-w-\[9rem\]/);
    expect(channels).toMatch(/key: 'target'[^\n]*hidden md:table-cell/);
  });
});
