// Parse the free-text Range / Area / Duration fields PF2e spells use into
// numbers we can put on a slider. The DB strings are inconsistent enough
// ("touch", "30 feet", "30-foot line", "planetary", "sustained up to 1
// minute", "until your next daily preparations") that the parsers are
// permissive: they return null for anything they can't classify, and
// applyStateFilter then treats those rows as "always pass" so a slider
// filter never silently hides a "varies" spell.
//
// Units we normalise to:
//   distance → feet (miles × 5280)
//   area     → feet (the leading number in "15-foot cone", etc.)
//   duration → seconds (round = 6s, turn = 6s, minute = 60s, ...)

import type { Spell } from '@schemas/content';

const MILE_FT = 5280;
const ROUND_SEC = 6;
// Wanderer's Guide v4 slider labels use single-letter unit codes so a
// "5 ft – 30 ft" range packs into the narrow slider track. The "K" used
// for kilometers below is metric (≈ 1.61 mi); we still parse the
// underlying spell text in miles via MILE_FT but display kilometers
// because that's what the approved wg4 mockup shows.
const KM_FT = 3280.84;

// Distance text → feet. Returns null if unparseable.
export function parseDistanceFt(s: string | null | undefined): number | null {
  if (!s) return null;
  const lower = s.toLowerCase().trim();
  if (!lower) return null;
  if (lower.startsWith('touch')) return 5;
  if (lower.startsWith('self')) return 0;
  if (lower.includes('planetary')) return 1_000_000;
  if (lower.includes('unlimited')) return 1_000_000;
  // "30 feet", "30 ft", "30-foot line", "1 mile"
  const m = lower.match(/(\d+)\s*-?\s*(foot|feet|ft|mile|miles|mi)\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  const isMile = /^mi/.test(m[2]);
  return isMile ? n * MILE_FT : n;
}

// Area text → leading-number feet. Returns null if unparseable.
export function parseAreaFt(s: string | null | undefined): number | null {
  if (!s) return null;
  const lower = s.toLowerCase().trim();
  if (!lower) return null;
  const m = lower.match(/(\d+)\s*-?\s*(foot|feet|ft)\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

// Duration text → seconds. Returns null if unparseable.
export function parseDurationSec(s: string | null | undefined): number | null {
  if (!s) return null;
  const lower = s.toLowerCase().trim();
  if (!lower) return null;

  // Sustained without an upper bound is ≈10 rounds (PF2e default).
  if (lower === 'sustained' || lower === 'sustained.' || lower === 'sustained spell') {
    return 60;
  }

  // "until your next daily preparations" ≈ 24h.
  if (lower.includes('daily preparation')) return 86_400;

  // Strip leading "sustained up to" so the unit match below picks up the
  // tail.
  const stripped = lower.replace(/^sustained up to\s+/, '');

  const m = stripped.match(/(\d+)\s+(round|rounds|turn|turns|minute|minutes|min|hour|hours|hr|day|days)\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  const unit = m[2];
  if (/^(round|turn)/.test(unit)) return n * ROUND_SEC;
  if (/^min/.test(unit)) return n * 60;
  if (/^(hour|hr)/.test(unit)) return n * 3600;
  if (/^day/.test(unit)) return n * 86_400;
  return null;
}

// Pretty-print a duration in seconds. Used for slider labels.
// Abbreviated to single-letter unit codes for the wg4 sliders:
//   rd = round, M = minute, H = hour, D = day, W = week.
export function formatDurationSec(sec: number): string {
  if (sec < 60) {
    const r = Math.round(sec / ROUND_SEC);
    return r === 1 ? '1 rd' : `${r} rd`;
  }
  if (sec < 3600) {
    const m = Math.round(sec / 60);
    return `${m} M`;
  }
  if (sec < 86_400) {
    const h = Math.round(sec / 3600);
    return `${h} H`;
  }
  if (sec < 604_800) {
    const d = Math.round(sec / 86_400);
    return `${d} D`;
  }
  const w = Math.round(sec / 604_800);
  return `${w} W`;
}

// Pretty-print feet (used for both Range and Area sliders).
// "F" for feet, "K" for kilometers — anything beyond a kilometer rounds
// to 1 decimal place. Note we display kilometers (not miles) per the
// approved wg4 mockup; the underlying data is still parsed in feet/miles
// via parseDistanceFt above.
export function formatFeet(ft: number): string {
  if (ft >= KM_FT) {
    const k = Math.round((ft / KM_FT) * 10) / 10;
    return k === 1 ? '1 K' : `${k} K`;
  }
  return `${ft} F`;
}

// Build the slider domain — sorted, unique numeric values for each of
// the three fields, computed from a spell array. Empty / single-value
// sets are still returned; the filter UI hides any slider that has
// fewer than two distinct values (otherwise the slider has nothing to
// span).
export type SpellFilterDomain = {
  range: number[];
  area: number[];
  duration: number[];
};

export function buildSpellFilterDomain(spells: Array<Partial<Spell>>): SpellFilterDomain {
  const r = new Set<number>();
  const a = new Set<number>();
  const d = new Set<number>();
  for (const s of spells) {
    const rv = parseDistanceFt(s.range);
    if (rv !== null) r.add(rv);
    const av = parseAreaFt(s.area);
    if (av !== null) a.add(av);
    const dv = parseDurationSec(s.duration);
    if (dv !== null) d.add(dv);
  }
  return {
    range: [...r].sort((x, y) => x - y),
    area: [...a].sort((x, y) => x - y),
    duration: [...d].sort((x, y) => x - y),
  };
}
