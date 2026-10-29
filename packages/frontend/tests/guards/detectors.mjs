// Plain ESM so both the vitest guards and prune-allowlists.mjs can use the same
// detectors without a TypeScript step. Patterns that involve the dash characters
// are built from escapes so this file stays free of them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';

export const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ALLOWLIST_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'allowlists');

/** Recursive listing of files under src/ with one of the extensions, repo-relative with forward slashes, sorted. */
export function listSourceFiles(exts, root = FRONTEND_ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.svelte-kit') continue;
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (exts.some((e) => name.endsWith(e))) {
        out.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(root, 'src'));
  return out.sort();
}

// ---------------------------------------------------------------------------
// no-confirm
// ---------------------------------------------------------------------------

const CONFIRM_CALL = /(?<![\w.$])(?:window\.)?confirm\(/g;

/** True when the source calls the native confirm() (a local `function confirm()` declaration is not a call). */
export function hasNativeConfirm(source) {
  CONFIRM_CALL.lastIndex = 0;
  let m;
  while ((m = CONFIRM_CALL.exec(source)) !== null) {
    const before = source.slice(0, m.index);
    if (/(?:^|[^\w$])function\s+$/.test(before)) continue;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// no-dash
// ---------------------------------------------------------------------------

const DASH = new RegExp('[\\u2014\\u2013]');

export function hasLongDash(source) {
  return DASH.test(source);
}

// ---------------------------------------------------------------------------
// icon-button-aria
// ---------------------------------------------------------------------------

function staticAttrValue(attr) {
  const v = attr.value;
  if (v === true) return true;
  const parts = Array.isArray(v) ? v : [v];
  if (parts.length !== 1) return undefined;
  const p = parts[0];
  if (p.type === 'Text') return p.data;
  if (p.type === 'ExpressionTag' && p.expression?.type === 'Literal') return p.expression.value;
  return undefined;
}

/**
 * Number of `<Button size="icon">` elements in a Svelte source that carry
 * neither aria-label, aria-labelledby nor a spread attribute.
 */
export function countUnlabelledIconButtons(source) {
  let ast;
  try {
    ast = parse(source, { modern: true });
  } catch {
    return 0;
  }
  let count = 0;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    if (node.type === 'Component' && node.name === 'Button' && Array.isArray(node.attributes)) {
      const attrs = node.attributes;
      const isIcon = attrs.some((a) => a.type === 'Attribute' && a.name === 'size' && staticAttrValue(a) === 'icon');
      if (isIcon) {
        const labelled = attrs.some(
          (a) =>
            a.type === 'SpreadAttribute' ||
            (a.type === 'Attribute' && (a.name === 'aria-label' || a.name === 'aria-labelledby'))
        );
        if (!labelled) count++;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      visit(node[key]);
    }
  };
  visit(ast.fragment);
  return count;
}

// ---------------------------------------------------------------------------
// Repository scans (used by the guards and by prune-allowlists.mjs)
// ---------------------------------------------------------------------------

const read = (rel, root) => readFileSync(path.join(root, rel), 'utf8');

export const RULES = {
  'no-confirm': (root = FRONTEND_ROOT) =>
    listSourceFiles(['.svelte', '.ts'], root)
      .filter((f) => !f.endsWith('.test.ts'))
      .filter((f) => hasNativeConfirm(read(f, root))),
  'no-dash': (root = FRONTEND_ROOT) =>
    listSourceFiles(['.svelte', '.ts', '.css', '.js'], root).filter((f) => hasLongDash(read(f, root))),
  'icon-button-aria': (root = FRONTEND_ROOT) =>
    listSourceFiles(['.svelte'], root).filter((f) => countUnlabelledIconButtons(read(f, root)) > 0),
};
