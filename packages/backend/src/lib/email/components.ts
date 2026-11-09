/**
 * Building blocks of the "Console" email design. Each returns a block of
 * table-safe HTML styled inline in the light theme; the class names let the
 * dark-mode block in layout.ts recolor them. Every text argument is escaped
 * here, so callers pass raw strings.
 */
import { escapeHtml } from './util.js';
import { light, toneColors, FONT_MONO, FONT_SANS, type Tone } from './tokens.js';

const L = light;

/** Status pill: tinted fill, line, dot and the word (color alone never carries meaning). */
export function pill(text: string, tone: Tone): string {
  const c = toneColors(L, tone);
  return `<div style="margin:0 0 16px;"><span class="lt-fill-${tone} lt-tone-${tone}" style="display:inline-block;padding:2px 10px;background-color:${c.fill};border:1px solid ${c.line};border-radius:9999px;font-family:${FONT_SANS};font-size:12px;line-height:16px;font-weight:500;color:${c.text};"><span class="lt-solid-${tone}" style="display:inline-block;width:6px;height:6px;margin:0 6px 1px 0;border-radius:9999px;background-color:${c.solid};vertical-align:middle;"></span>${escapeHtml(text)}</span></div>`;
}

export function title(text: string): string {
  return `<h1 class="lt-text" style="margin:0 0 8px;font-family:${FONT_SANS};font-size:24px;line-height:32px;font-weight:600;letter-spacing:-0.025em;color:${L.text};">${escapeHtml(text)}</h1>`;
}

export function paragraph(text: string, opts: { muted?: boolean } = {}): string {
  const muted = opts.muted !== false;
  return `<p class="${muted ? 'lt-muted' : 'lt-text'}" style="margin:0 0 24px;font-family:${FONT_SANS};font-size:14px;line-height:20px;color:${muted ? L.muted : L.text};">${escapeHtml(text)}</p>`;
}

/** The key metric of an email, large and in mono, with a one-line caption. */
export function bigNumber(value: string, caption: string, tone?: Tone): string {
  const color = tone ? toneColors(L, tone).text : L.text;
  const cls = tone ? `lt-tone-${tone}` : 'lt-text';
  return `<div class="${cls}" style="margin:8px 0 0;font-family:${FONT_MONO};font-size:44px;line-height:52px;font-weight:600;letter-spacing:-0.03em;color:${color};">${escapeHtml(value)}</div><p class="lt-muted" style="margin:4px 0 24px;font-family:${FONT_SANS};font-size:14px;line-height:20px;color:${L.muted};">${escapeHtml(caption)}</p>`;
}

/**
 * Threshold bar: the part under the threshold in the track color, the
 * overshoot in red, a mark at the threshold. Empty unless value > threshold > 0.
 */
export function meter(opts: { value: number; threshold: number; label: string }): string {
  const { value, threshold } = opts;
  if (!(threshold > 0) || !(value > threshold) || !Number.isFinite(value)) return '';
  const mark = Math.min(98, Math.max(2, Math.round((threshold / value) * 100)));
  const over = 100 - mark;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border-collapse:collapse;"><tr>
<td class="lt-track" width="${mark}%" height="8" style="width:${mark}%;height:8px;background-color:${L.track};border-radius:4px 0 0 4px;font-size:0;line-height:0;">&nbsp;</td>
<td class="lt-mark" width="2" height="8" style="width:2px;height:8px;background-color:${L.text};font-size:0;line-height:0;">&nbsp;</td>
<td class="lt-solid-error" width="${over}%" height="8" style="height:8px;background-color:${L.errorSolid};border-radius:0 4px 4px 0;font-size:0;line-height:0;">&nbsp;</td>
</tr></table><p class="lt-muted" style="margin:0 0 32px;padding-left:${mark}%;font-family:${FONT_MONO};font-size:12px;line-height:16px;color:${L.muted};">${escapeHtml(opts.label)}</p>`;
}

/** key=value lines in mono on a raised block, like a log record. */
export function logBlock(rows: Array<{ key: string; value: string }>): string {
  if (rows.length === 0) return '';
  const lines = rows
    .map(
      (r) =>
        `<div><span class="lt-key" style="color:${L.key};">${escapeHtml(r.key)}</span><span class="lt-muted" style="color:${L.muted};">=</span>${escapeHtml(r.value)}</div>`,
    )
    .join('');
  return `<div class="lt-card lt-text" style="margin:0 0 32px;padding:16px;background-color:${L.card};border:1px solid ${L.border};border-radius:8px;font-family:${FONT_MONO};font-size:12px;line-height:20px;color:${L.text};word-break:break-word;">${lines}</div>`;
}

export function codeBlock(text: string): string {
  return `<div class="lt-card lt-text" style="margin:0 0 24px;padding:16px;background-color:${L.card};border:1px solid ${L.border};border-radius:8px;font-family:${FONT_MONO};font-size:12px;line-height:20px;color:${L.text};white-space:pre-wrap;word-break:break-word;">${escapeHtml(text)}</div>`;
}

export interface Cell {
  text: string;
  tone?: Tone;
  muted?: boolean;
}

/** A hairline table in mono, for digest lists. alignRight lists column indexes. */
export function dataTable(headers: string[], rows: Cell[][], opts: { alignRight?: number[] } = {}): string {
  // Digests repeat this table many times: fonts and the base color sit on the
  // table and cells carry only what differs, to stay under Gmail's 102 KB clip.
  const right = new Set(opts.alignRight ?? []);
  const pad = (i: number, last: number, v: number) => `padding:${v}px ${i === last ? 0 : 12}px ${v}px 0;`;
  const alignAttr = (i: number) => (right.has(i) ? ' align="right"' : '');
  const head = headers
    .map(
      (h, i) =>
        `<th class="lt-muted lt-border"${alignAttr(i)} style="${pad(i, headers.length - 1, 8)}border-bottom:1px solid ${L.border};font-family:${FONT_SANS};font-weight:500;color:${L.muted};${right.has(i) ? 'text-align:right;' : 'text-align:left;'}">${escapeHtml(h)}</th>`,
    )
    .join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, i) => {
            const tone = cell.tone
              ? ` lt-tone-${cell.tone}" style="color:${toneColors(L, cell.tone).text};`
              : cell.muted
                ? ` lt-muted" style="color:${L.muted};`
                : '" style="';
            return `<td class="lt-border${tone}${pad(i, row.length - 1, 10)}border-bottom:1px solid ${L.border};"${alignAttr(i)}>${escapeHtml(cell.text)}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="lt-text" style="margin:0 0 32px;border-collapse:collapse;font-family:${FONT_MONO};font-size:12px;line-height:16px;color:${L.text};word-break:break-word;"><tr>${head}</tr>${body}</table>`;
}

export function sectionTitle(text: string): string {
  return `<h2 class="lt-text" style="margin:0 0 8px;font-family:${FONT_SANS};font-size:18px;line-height:28px;font-weight:600;color:${L.text};">${escapeHtml(text)}</h2>`;
}

export function emptyLine(text: string): string {
  return `<p class="lt-muted" style="margin:0 0 32px;font-family:${FONT_SANS};font-size:14px;line-height:20px;color:${L.muted};">${escapeHtml(text)}</p>`;
}

/** Relative luminance contrast of white text on a #rrggbb background. */
export function contrastWithWhite(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const channel = (i: number) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return 1.05 / (lum + 0.05);
}

/** Bulletproof button: the colored cell paints in Outlook, the link carries the padding elsewhere. */
export function button(label: string, url: string, opts: { color?: string } = {}): string {
  const bg = opts.color ?? L.button;
  const href = escapeHtml(url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 32px;border-collapse:separate;"><tr><td bgcolor="${bg}" style="background-color:${bg};border-radius:6px;"><a href="${href}" class="lt-btn" style="display:inline-block;padding:10px 16px;font-family:${FONT_SANS};font-size:14px;line-height:20px;font-weight:500;color:${L.buttonText};text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a></td></tr></table>`;
}

/** The raw link in mono under a button, for clients that break buttons. */
export function linkFallback(url: string): string {
  return `<p class="lt-muted" style="margin:-16px 0 8px;font-family:${FONT_SANS};font-size:14px;line-height:20px;color:${L.muted};">If the button does not work, paste this address in your browser:</p><div class="lt-card lt-text" style="margin:0 0 32px;padding:12px 16px;background-color:${L.card};border:1px solid ${L.border};border-radius:8px;font-family:${FONT_MONO};font-size:12px;line-height:16px;color:${L.text};word-break:break-all;">${escapeHtml(url)}</div>`;
}

/** A tinted message box with a hairline all round (never a left border). */
export function notice(text: string, tone: Tone): string {
  const c = toneColors(L, tone);
  return `<div class="lt-fill-${tone} lt-text" style="margin:0 0 24px;padding:12px 16px;background-color:${c.fill};border:1px solid ${c.line};border-radius:8px;font-family:${FONT_SANS};font-size:14px;line-height:20px;color:${L.text};">${escapeHtml(text)}</div>`;
}

/** label / value rows with hairlines: label in sans, value in mono on the right. */
export function statRows(rows: Array<{ label: string; value: string; isCode?: boolean }>): string {
  if (rows.length === 0) return '';
  const body = rows
    .map(
      (r) =>
        `<tr><td class="lt-muted lt-border" style="padding:10px 12px 10px 0;border-bottom:1px solid ${L.border};font-family:${FONT_SANS};font-size:14px;line-height:20px;color:${L.muted};">${escapeHtml(r.label)}</td><td class="lt-text lt-border" align="right" style="padding:10px 0;border-bottom:1px solid ${L.border};font-family:${FONT_MONO};font-size:12px;line-height:20px;color:${L.text};text-align:right;word-break:break-word;">${escapeHtml(r.value)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;border-collapse:collapse;border-top:1px solid ${L.border};" class="lt-border">${body}</table>`;
}
