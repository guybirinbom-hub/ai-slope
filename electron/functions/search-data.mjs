// Search across all content tables. Originally used Postgres tsvector; we
// fall back to ILIKE on name + description for the simple case since the
// dump doesn't ship the search_tsv column. Cap each table at 20 hits.
//
// ADVANCED MODE (`is_advanced: true`) — the AdvancedSearchModal sends a rich
// FiltersParams object (name, rarity, traits, level/rank ranges, spell
// traditions, item size/group, …) plus a `type` naming ONE content type.
// The original cloud function applied those filters server-side; the first
// local port ignored everything except `text`, so the Advanced Search UI
// always returned zero rows. This implementation builds a parameterized
// WHERE per filter, gated on the columns each table actually has (see
// data/schema.sql), and only queries the requested type's table.

import { defineFunction, getPool } from './_shared.mjs';

const EMPTY = {
  ability_blocks: [], ancestries: [], archetypes: [], backgrounds: [],
  classes: [], creatures: [], items: [], languages: [], spells: [],
  traits: [], versatile_heritages: [], class_archetypes: [],
};

const TABLE_TO_KEY = {
  ability_block: 'ability_blocks',
  ancestry: 'ancestries',
  archetype: 'archetypes',
  background: 'backgrounds',
  class: 'classes',
  class_archetype: 'class_archetypes',
  creature: 'creatures',
  item: 'items',
  language: 'languages',
  spell: 'spells',
  trait: 'traits',
  versatile_heritage: 'versatile_heritages',
};

// Frontend ContentType → table name.
const TYPE_TO_TABLE = {
  'ability-block': 'ability_block',
  'ancestry': 'ancestry',
  'archetype': 'archetype',
  'background': 'background',
  'class': 'class',
  'class-archetype': 'class_archetype',
  'creature': 'creature',
  'item': 'item',
  'language': 'language',
  'spell': 'spell',
  'trait': 'trait',
  'versatile-heritage': 'versatile_heritage',
};

const SEARCH_COLS = {
  ability_block: 'id, name, description, level, type, traits, content_source_id',
  ancestry: 'id, name, description, content_source_id',
  archetype: 'id, name, description, content_source_id',
  background: 'id, name, description, content_source_id',
  class: 'id, name, description, content_source_id',
  class_archetype: 'id, name, description, content_source_id',
  creature: 'id, name, level, content_source_id',
  item: 'id, name, description, level, traits, "group", hands, content_source_id',
  language: 'id, name, description, content_source_id',
  spell: 'id, name, description, rank, traits, traditions, content_source_id',
  trait: 'id, name, description, content_source_id',
  versatile_heritage: 'id, name, description, content_source_id',
};

async function searchTable(pool, table, text, contentSources) {
  const params = [`%${text}%`];
  let where = '(name ILIKE $1';
  if (table !== 'creature') where += ' OR description ILIKE $1';
  where += ')';
  if (contentSources && contentSources.length) {
    const placeholders = contentSources.map((_, i) => `$${i + 2}`).join(', ');
    where += ` AND content_source_id IN (${placeholders})`;
    params.push(...contentSources);
  }
  const sql = `SELECT ${SEARCH_COLS[table]} FROM public."${table}" WHERE ${where} LIMIT 20`;
  const r = await pool.query(sql, params);
  return r.rows;
}

// ─── Advanced mode ──────────────────────────────────────────────────────────

// Which optional columns each table actually has (schema.sql). Filters whose
// column is absent on the requested table are silently skipped — matching
// the cloud behaviour where they simply didn't apply.
const TABLE_COLS = {
  ability_block: ['description', 'level', 'rarity', 'availability', 'traits', 'actions',
    'frequency', 'cost', 'trigger', 'requirements', 'access', 'special', 'prerequisites', 'type'],
  ancestry: ['description', 'rarity'],
  archetype: ['description', 'rarity'],
  background: ['description', 'rarity'],
  class: ['description', 'rarity'],
  class_archetype: ['description', 'rarity'],
  creature: ['level', 'rarity'],
  item: ['description', 'level', 'rarity', 'availability', 'traits', 'size', 'group',
    'bulk', 'hands', 'usage', 'craft_requirements'],
  language: ['description', 'rarity', 'availability'],
  spell: ['description', 'rarity', 'availability', 'traits', 'rank', 'cast', 'traditions',
    'defense', 'range', 'area', 'targets', 'duration', 'cost', 'trigger', 'requirements'],
  trait: ['description'],
  versatile_heritage: ['description', 'rarity'],
};

// A "1 action" search should also surface ONE-TO-TWO / ONE-TO-THREE plays —
// the same expansion the frontend pickers use.
const COST_MATCHES = {
  'ONE-ACTION': ['ONE-ACTION', 'ONE-TO-TWO-ACTIONS', 'ONE-TO-THREE-ACTIONS'],
  'TWO-ACTIONS': ['TWO-ACTIONS', 'ONE-TO-TWO-ACTIONS', 'ONE-TO-THREE-ACTIONS', 'TWO-TO-THREE-ACTIONS'],
  'THREE-ACTIONS': ['THREE-ACTIONS', 'ONE-TO-THREE-ACTIONS', 'TWO-TO-THREE-ACTIONS'],
  'FREE-ACTION': ['FREE-ACTION'],
  'REACTION': ['REACTION'],
};

const MAX_ADVANCED_RESULTS = 10000;

async function advancedSearch(pool, body) {
  const table = TYPE_TO_TABLE[body.type];
  if (!table) return { ...EMPTY };
  const cols = TABLE_COLS[table] ?? [];
  const has = (c) => cols.includes(c);

  const params = [];
  const where = [];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const ilike = (col, val) => {
    if (val === undefined || val === null || String(val).trim() === '') return;
    where.push(`${col} ILIKE ${p(`%${String(val).trim()}%`)}`);
  };
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  // Name + description.
  ilike('name', body.name);
  if (has('description')) ilike('description', body.description);

  // Rarity / availability — uppercase enums in the data.
  if (str(body.rarity)) where.push(`rarity = ${p(str(body.rarity).toUpperCase())}`);
  if (has('availability') && str(body.availability)) {
    where.push(`availability = ${p(str(body.availability).toUpperCase())}`);
  }

  // Traits — bigint[] of trait ids; option must carry EVERY selected id.
  if (has('traits') && Array.isArray(body.traits) && body.traits.length > 0) {
    const ids = body.traits.map((t) => parseInt(t)).filter((n) => !isNaN(n));
    if (ids.length > 0) where.push(`traits @> ${p(ids)}::bigint[]`);
  }

  // Level / rank ranges.
  if (has('level')) {
    if (typeof body.level_min === 'number') where.push(`COALESCE(level, 0) >= ${p(body.level_min)}`);
    if (typeof body.level_max === 'number') where.push(`COALESCE(level, 0) <= ${p(body.level_max)}`);
  }
  if (has('rank')) {
    if (typeof body.rank_min === 'number') where.push(`COALESCE(rank, 0) >= ${p(body.rank_min)}`);
    if (typeof body.rank_max === 'number') where.push(`COALESCE(rank, 0) <= ${p(body.rank_max)}`);
  }

  // Ability-block specifics.
  if (table === 'ability_block') {
    if (str(body.ab_type)) where.push(`type = ${p(str(body.ab_type))}`);
    if (str(body.actions)) {
      const expanded = COST_MATCHES[str(body.actions).toUpperCase()] ?? [str(body.actions)];
      where.push(`actions = ANY(${p(expanded)}::text[])`);
    }
    ilike('frequency', body.frequency);
    ilike('cost', body.cost);
    ilike('trigger', body.trigger);
    ilike('requirements', body.requirements);
    ilike('access', body.access);
    ilike('special', body.special);
    // Prerequisites — varchar[]; each requested string must appear somewhere
    // in the joined prereq text.
    if (Array.isArray(body.prerequisites)) {
      for (const pre of body.prerequisites) {
        if (str(pre)) {
          where.push(`array_to_string(COALESCE(prerequisites, '{}'), ' ') ILIKE ${p(`%${str(pre)}%`)}`);
        }
      }
    } else if (str(body.prerequisites)) {
      where.push(`array_to_string(COALESCE(prerequisites, '{}'), ' ') ILIKE ${p(`%${str(body.prerequisites)}%`)}`);
    }
  }

  // Spell specifics.
  if (table === 'spell') {
    ilike('"cast"', body.cast);
    ilike('defense', body.defense);
    ilike('range', body.range);
    ilike('area', body.area);
    ilike('targets', body.targets);
    ilike('duration', body.duration);
    ilike('cost', body.cost);
    ilike('trigger', body.trigger);
    ilike('requirements', body.requirements);
    // Traditions — varchar[] of lowercase names; match ANY selected.
    if (Array.isArray(body.traditions) && body.traditions.length > 0) {
      const wanted = body.traditions.map((t) => String(t).toLowerCase().trim()).filter(Boolean);
      if (wanted.length > 0) {
        where.push(
          `EXISTS (SELECT 1 FROM unnest(COALESCE(traditions, '{}')) tr WHERE LOWER(tr) = ANY(${p(wanted)}::text[]))`
        );
      }
    }
    // Spell type — focus/ritual flags live in meta_data (jsonb).
    const st = str(body.spell_type).toUpperCase();
    if (st === 'FOCUS') where.push(`COALESCE((meta_data->>'focus')::boolean, false) IS TRUE`);
    else if (st === 'RITUAL') where.push(`COALESCE((meta_data->>'ritual')::boolean, false) IS TRUE`);
    else if (st === 'NORMAL') {
      where.push(`COALESCE((meta_data->>'focus')::boolean, false) IS FALSE`);
      where.push(`COALESCE((meta_data->>'ritual')::boolean, false) IS FALSE`);
    }
  }

  // Item specifics.
  if (table === 'item') {
    if (str(body.size)) where.push(`size = ${p(str(body.size).toUpperCase())}`);
    if (str(body.group)) where.push(`"group" = ${p(str(body.group).toUpperCase())}`);
    ilike('bulk', body.bulk);
    ilike('hands', body.hands);
    ilike('usage', body.usage);
    ilike('craft_requirements', body.craft_requirements);
  }

  // Content sources.
  if (Array.isArray(body.content_sources) && body.content_sources.length > 0) {
    where.push(`content_source_id = ANY(${p(body.content_sources)}::bigint[])`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT * FROM public."${table}" ${whereSql} ORDER BY name LIMIT ${MAX_ADVANCED_RESULTS}`;
  const r = await pool.query(sql, params);

  const data = { ...EMPTY };
  data[TABLE_TO_KEY[table]] = r.rows;
  return data;
}

export default defineFunction(async (ctx) => {
  const body = ctx.body || {};
  const pool = getPool();

  // Advanced mode — single-type, full filter set.
  if (body.is_advanced) {
    try {
      const data = await advancedSearch(pool, body);
      return { status: 'success', data };
    } catch (e) {
      console.error('search-data advanced error:', e);
      return { status: 'success', data: { ...EMPTY } };
    }
  }

  const text = body.text || '';
  if (text.length < 2) {
    return { status: 'success', data: { ...EMPTY } };
  }
  const tables = Object.keys(TABLE_TO_KEY);
  const rows = await Promise.all(
    tables.map((t) => searchTable(pool, t, text, body.content_sources).catch(() => []))
  );
  const data = { ...EMPTY };
  tables.forEach((t, i) => { data[TABLE_TO_KEY[t]] = rows[i]; });
  return { status: 'success', data };
});
