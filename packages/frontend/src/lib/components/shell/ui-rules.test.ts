import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// W1 file-scoped guard for the spec section 3 UI rules. The list is explicit:
// every file W1 owns or created (tests and stubs excluded).
const SRC = path.resolve(__dirname, '../../..');
const FILES = [
  'lib/components/AppLayout.svelte',
  'lib/components/CommandPalette.svelte',
  'lib/components/CreateOrganizationDialog.svelte',
  'lib/components/CreateProjectDialog.svelte',
  'lib/components/Footer.svelte',
  'lib/components/OrganizationSwitcher.svelte',
  'lib/components/RequireOrganization.svelte',
  'lib/components/ShortcutsHelpModal.svelte',
  'lib/components/shell/DashboardErrorState.svelte',
  'lib/components/shell/HeaderBreadcrumb.svelte',
  'lib/components/shell/PageSkeleton.svelte',
  'lib/components/shell/SidebarNav.svelte',
  'lib/components/shell/error-details.ts',
  'lib/components/shell/events.ts',
  'lib/components/shell/last-event.ts',
  'lib/components/shell/org-switch.ts',
  'lib/components/shell/project-links.ts',
  'lib/components/shell/settings-pages.ts',
  'lib/components/shell/palette/providers.ts',
  'lib/components/shell/palette/registry.ts',
  'lib/components/shell/palette/trace-target.ts',
  'lib/components/shell/palette/types.ts',
  'lib/nav/nav-icons.ts',
  'lib/nav/nav-items.ts',
  'lib/nav/section-path.ts',
  'lib/stores/org-projects.ts',
  'lib/stores/shortcuts.ts',
  'routes/dashboard/+layout.svelte',
  'routes/dashboard/projects/+page.svelte',
  'routes/dashboard/projects/[id]/+layout.svelte',
  'routes/dashboard/projects/[id]/+page.svelte',
  'routes/dashboard/projects/[id]/overview/+page.svelte',
];

const sources = FILES.map((f) => ({ file: f, text: readFileSync(path.join(SRC, f), 'utf8') }));

function offenders(test: (text: string, file: string) => boolean): string[] {
  return sources.filter((s) => test(s.text, s.file)).map((s) => s.file);
}

/** Opening tags with the given name, respecting braces so `=>` inside handlers is fine. */
function openingTags(text: string, tag: string): Array<{ attrs: string; end: number }> {
  const out: Array<{ attrs: string; end: number }> = [];
  const re = new RegExp(`<${tag}(?=[\\s>/])`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    const start = i;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        if (depth === 0) quote = c;
      } else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ attrs: text.slice(start, i), end: i + 1 });
  }
  return out;
}

function hasVisibleText(text: string, from: string): boolean {
  const close = text.indexOf(`</${from}>`);
  const inner = text.slice(0, close === -1 ? undefined : close);
  const stripped = inner
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{#[^}]*\}|\{\/[^}]*\}|\{:[^}]*\}/g, ' ')
    .trim();
  return stripped.length > 0;
}

describe('W1 UI rules', () => {
  it('the button detector catches an unlabeled icon button and accepts a labeled one', () => {
    const bad = '<Button size="icon" onclick={() => go()}><X /></Button>';
    const good = '<Button size="icon" aria-label="Close" onclick={() => go()}><X /></Button>';
    expect(openingTags(bad, 'Button')).toHaveLength(1);
    expect(/aria-labels*=/.test(openingTags(bad, 'Button')[0].attrs)).toBe(false);
    expect(/aria-labels*=/.test(openingTags(good, 'Button')[0].attrs)).toBe(true);
    expect(hasVisibleText('<X /></button>', 'button')).toBe(false);
    expect(hasVisibleText('<X /> Close</button>', 'button')).toBe(true);
  });


  it('no native confirm()', () => {
    expect(offenders((t) => /(^|[^.\w])confirm\s*\(/.test(t))).toEqual([]);
  });

  it('no em or en dash', () => {
    const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    expect(offenders((t) => dashes.test(t))).toEqual([]);
  });

  it('no "successfully" and no toast ending in "!"', () => {
    expect(offenders((t) => /successfully/i.test(t))).toEqual([]);
    expect(offenders((t) => /toastStore\.\w+\(\s*[`'"][^`'"]*![`'"]/.test(t))).toEqual([]);
  });

  it('every icon-only button has an aria-label', () => {
    const bad: string[] = [];
    for (const { file, text } of sources) {
      if (!file.endsWith('.svelte')) continue;
      for (const tag of ['Button', 'button']) {
        for (const { attrs, end } of openingTags(text, tag)) {
          if (/aria-label\s*=/.test(attrs) || /\{\.\.\.[a-zA-Z]/.test(attrs)) continue;
          const iconSized = /size="icon/.test(attrs);
          const noText = !hasVisibleText(text.slice(end), tag);
          if (iconSized || (tag === 'button' && noText)) bad.push(`${file}: <${tag}${attrs.slice(0, 50)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('no raw palette colours for status', () => {
    const re = /\b(text|bg|border)-(red|green|yellow|amber|orange)-\d{2,3}\b/;
    expect(offenders((t) => re.test(t))).toEqual([]);
  });

  it('only en-US toLocale calls', () => {
    const bad = offenders((t) => {
      const calls = t.match(/\.toLocale\w*\([^)]*\)/g) ?? [];
      return calls.some((c) => !/\('en-US'/.test(c));
    });
    expect(bad).toEqual([]);
  });

  it('no Title Case in static strings from the denylist', () => {
    const deny = [
      'Create Organization',
      'Create Project',
      'New Project',
      'User Settings',
      'Organization Settings',
      'Layout Settings',
      'Content Width',
      'Quick Actions',
      'Keyboard Shortcuts',
      'Your Organizations',
      'Project Name',
      'Move to Trash',
      'Delete Project',
    ];
    const bad: string[] = [];
    for (const { file, text } of sources) {
      for (const phrase of deny) if (text.includes(phrase)) bad.push(`${file}: ${phrase}`);
    }
    expect(bad).toEqual([]);
  });
});
