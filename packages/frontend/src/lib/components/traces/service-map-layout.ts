/** 32-bit FNV-1a hash, fixed so the layout never changes between runs. */
function fnv1a(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic starting positions for the service map nodes: sorted names on
 * a circle, with a small hash-based angular jitter so nodes of a regular
 * circle do not line up edges perfectly. Same name set gives the same picture,
 * whatever the input order, so a reload does not reshuffle the graph.
 */
export function stableNodePositions(
  names: string[],
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const w = Number.isFinite(width) && width > 0 ? width : 800;
  const h = Number.isFinite(height) && height > 0 ? height : 500;
  const unique = [...new Set(names)].sort();
  const result = new Map<string, { x: number; y: number }>();
  const cx = w / 2;
  const cy = h / 2;

  if (unique.length === 1) {
    result.set(unique[0], { x: cx, y: cy });
    return result;
  }

  const radius = Math.min(w, h) * 0.35;
  const step = (2 * Math.PI) / unique.length;
  unique.forEach((name, index) => {
    const jitter = ((fnv1a(name) % 1000) / 1000 - 0.5) * step * 0.3;
    const angle = index * step + jitter - Math.PI / 2;
    result.set(name, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });
  return result;
}
