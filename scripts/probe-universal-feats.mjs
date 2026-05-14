import pg from 'pg';
pg.types.setTypeParser(20, (v) => v === null ? null : Number(v));
pg.types.setTypeParser(1016, (v) => {
  if (v === null) return null;
  const i = v.slice(1, -1);
  return i ? i.split(',').map(Number) : [];
});
const p = new pg.Pool({ host: 'localhost', port: 54422, user: 'postgres', password: 'wglocal', database: 'postgres' });

// Canonical "Universal Ancestry Feats" feat names from PF2e (factual game
// identifiers — not copyrighted descriptions).
const KNOWN_NAMES = [
  'Adopted Ancestry',
  'Ancestral Linguistics',
  'Ancestral Suspicion',
  'Bone Investiture',
  'Bouncing Touch',
  'Cooperative Nature',
  'Cooperative Soul',
  'Death\'s Embrace',
  'Diviner\'s Sight',
  'Eternal Hope',
  'General Training',
  'Half-Truths',
  'Hardy Traveler',
  'Haughty Obstinacy',
  'Lasting Armament',
  'Multitalented',
  'Natural Ambition',
  'Natural Skill',
  'Ribbon Speaker',
  'Unconventional Weaponry',
];

const r = await p.query(
  `SELECT id, name, level, content_source_id, traits
   FROM public.ability_block
   WHERE type='feat' AND lower(name) = ANY($1::text[])
   ORDER BY name, level, content_source_id`,
  [KNOWN_NAMES.map((s) => s.toLowerCase())]
);
const found = new Map();
for (const f of r.rows) {
  const key = f.name.toLowerCase();
  if (!found.has(key)) found.set(key, []);
  found.get(key).push(f);
}

console.log('=== KNOWN universal-ancestry feat names: which are in DB? ===');
for (const name of KNOWN_NAMES) {
  const matches = found.get(name.toLowerCase()) || [];
  if (matches.length === 0) {
    console.log('  MISSING:', name);
  } else {
    for (const m of matches) {
      const inUserSources = [1, 3, 7, 8].includes(m.content_source_id);
      console.log(`  ${inUserSources ? 'IN' : 'OUT'}: ${m.name} (L${m.level}, cs=${m.content_source_id})`);
    }
  }
}
await p.end();
