/**
 * Sheet accent theming.
 *
 * The wg4 sheet's accent (the "orange" — var(--wg4-accent)) is used in two
 * conflicting ways across the stylesheet:
 *   - as a BACKGROUND with light text on it (key-ability box, level emblem,
 *     active toggles, badges, buttons), and
 *   - as a DETAIL/foreground (borders, fills, dots, accent-coloured text) on
 *     both the light parchment and the dark slate surfaces.
 *
 * Letting the user pick a fully arbitrary colour would break one of those
 * (e.g. a near-white accent makes the white-on-accent text vanish; a near-black
 * accent disappears against the dark surface). Since the light text is
 * hard-coded in dozens of rules, we can't make every one contrast-aware.
 *
 * Instead we keep the user's HUE/saturation but CLAMP the colour's relative
 * luminance into a band that stays legible everywhere — the same band the
 * default rust accent already sits in. That guarantees "changing the colour
 * doesn't break visibility" without touching any of the accent rules.
 */

// Relative-luminance band (WCAG). The default accent #cf6a3f is ~0.24, so this
// keeps custom accents in the same proven-readable range:
//   - max 0.30 → white text on the accent stays >= 3:1 (fine for the bold,
//     large numbers shown on accent backgrounds),
//   - min 0.12 → the accent stays visible as borders/fills on the dark surface.
const LUM_MAX = 0.3;
const LUM_MIN = 0.12;

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 6 || h.length === 8) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return { r, g, b };
  }
  return null;
}

// sRGB channel → linear, per WCAG.
function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relLuminance(r: number, g: number, b: number): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((n) => clampByte(n).toString(16).padStart(2, '0')).join('');
}

/**
 * Adjust a colour's luminance into [LUM_MIN, LUM_MAX] while preserving its hue:
 *   - too bright → scale all channels toward black (keeps hue, drops luminance),
 *   - too dark   → blend toward white (keeps hue, raises luminance).
 * Binary search the factor so the result lands on the band edge.
 */
function clampLuminance(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const L = relLuminance(r, g, b);
  if (L > LUM_MAX) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (relLuminance(r * m, g * m, b * m) > LUM_MAX) hi = m;
      else lo = m;
    }
    const m = (lo + hi) / 2;
    return { r: r * m, g: g * m, b: b * m };
  }
  if (L < LUM_MIN) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      const rr = r + (255 - r) * m;
      const gg = g + (255 - g) * m;
      const bb = b + (255 - b) * m;
      if (relLuminance(rr, gg, bb) < LUM_MIN) lo = m;
      else hi = m;
    }
    const m = (lo + hi) / 2;
    return { r: r + (255 - r) * m, g: g + (255 - g) * m, b: b + (255 - b) * m };
  }
  return { r, g, b };
}

/**
 * Given a user-chosen colour, return the three wg4 accent CSS variables to
 * apply, with luminance clamped so visibility is preserved. Returns null if the
 * input isn't a valid colour (caller should then leave the defaults alone).
 */
export function accentVars(hex: string): Record<string, string> | null {
  const parsed = parseHex(hex);
  if (!parsed) return null;
  const { r, g, b } = clampLuminance(parsed.r, parsed.g, parsed.b);
  const accent = toHex(r, g, b);
  return {
    '--wg4-accent': accent,
    // Soft accent fill — a low-alpha tint that reads correctly over any surface.
    '--wg4-accent-soft': `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, 0.16)`,
    // Accent-coloured text/icons. The clamped accent is in a band that contrasts
    // with both the light and dark surfaces, so it doubles as the ink colour.
    '--wg4-accent-ink': accent,
  };
}
