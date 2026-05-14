// Search across all content tables. Originally used Postgres tsvector; we
// fall back to ILIKE on name + description for the simple case since the
// dump doesn't ship the search_tsv column. Cap each table at 20 hits.

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

export default defineFunction(async (ctx) => {
  const body = ctx.body || {};
  const text = body.text || '';
  if (text.length < 2) {
    return { status: 'success', data: { ...EMPTY } };
  }
  const pool = getPool();
  const tables = Object.keys(TABLE_TO_KEY);
  const rows = await Promise.all(
    tables.map((t) => searchTable(pool, t, text, body.content_sources).catch(() => []))
  );
  const data = { ...EMPTY };
  tables.forEach((t, i) => { data[TABLE_TO_KEY[t]] = rows[i]; });
  return { status: 'success', data };
});
