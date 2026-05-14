import pg from 'pg';
pg.types.setTypeParser(20, (v) => v === null ? null : Number(v));
pg.types.setTypeParser(1016, (v) => {
  if (v === null) return null;
  const i = v.slice(1, -1);
  return i ? i.split(',').map(Number) : [];
});
const p = new pg.Pool({ host: 'localhost', port: 54422, user: 'postgres', password: 'wglocal', database: 'postgres' });

const r = await p.query(
  "SELECT id, name FROM public.trait WHERE name IN ('Skill','Ancestry','Versatile','Universal','Human','Dwarf','Elf','Halfling','Gnome','Goblin')"
);
console.log('relevant trait ids:', r.rows);
const skillIds = r.rows.filter(t => t.name === 'Skill').map(t => t.id);
const ancestryNameIds = r.rows.filter(t => ['Human','Dwarf','Elf','Halfling','Gnome','Goblin'].includes(t.name)).map(t => t.id);
console.log('skill ids:', skillIds);
console.log('ancestry-name ids:', ancestryNameIds);

// Feats with General trait that are NOT Skill feats, at level 1, in user's content sources
const r2 = await p.query(
  `SELECT id, name, level, traits, content_source_id
   FROM public.ability_block
   WHERE type='feat'
     AND traits @> ARRAY[1437]::bigint[]
     AND NOT traits && $1::bigint[]
     AND level = 1
     AND content_source_id IN (1,3,7,8)
   ORDER BY name LIMIT 30`,
  [skillIds.length ? skillIds : [0]]
);
console.log('---General, non-Skill, level=1, in user sources:', r2.rows.length, '---');
for (const f of r2.rows) console.log('  ', f.name);
await p.end();
