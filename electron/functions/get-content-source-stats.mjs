// Returns per-table row counts for a content source. Used by the content
// source page to show "this book has N feats, M items, ..."

import { defineFunction, getPool } from './_shared.mjs';

const COUNTED_TABLES = [
  'ability_block', 'ancestry', 'archetype', 'background', 'class',
  'class_archetype', 'creature', 'item', 'language', 'spell',
  'trait', 'versatile_heritage',
];

export default defineFunction(async (ctx) => {
  const id = ctx.body && ctx.body.id;
  if (id === undefined) return { status: 'error', message: 'id required' };
  const counts = {};
  const pool = getPool();
  for (const t of COUNTED_TABLES) {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM public."${t}" WHERE content_source_id = $1`,
      [id]
    );
    counts[t] = r.rows[0]?.n || 0;
  }
  return { status: 'success', data: counts };
});
