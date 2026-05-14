// Generic deletion by (table, id). Accepts either the kebab-case ContentType
// the frontend uses (e.g. 'ability-block', 'class-archetype') or the
// snake_case TableName the DB uses (e.g. 'ability_block'). Cascades a
// trait_id reference, if any (mirrors the original delete-content logic).

import { defineFunction, fetchData, deleteData, getPool } from './_shared.mjs';

const CONTENT_TYPE_TO_TABLE = {
  'trait': 'trait',
  'item': 'item',
  'spell': 'spell',
  'class': 'class',
  'creature': 'creature',
  'ability-block': 'ability_block',
  'ancestry': 'ancestry',
  'background': 'background',
  'language': 'language',
  'content-source': 'content_source',
  'archetype': 'archetype',
  'versatile-heritage': 'versatile_heritage',
  'class-archetype': 'class_archetype',
};

const ALLOWED_TABLES = new Set([
  'ability_block', 'content_source', 'character', 'campaign',
  'ancestry', 'trait', 'class', 'background', 'item', 'spell',
  'creature', 'language', 'encounter', 'archetype',
  'versatile_heritage', 'class_archetype',
]);

export default defineFunction(async (ctx) => {
  const { id, type } = ctx.body || {};
  if (id === undefined || id === null) return { status: 'error', message: 'id required' };
  const tableName = CONTENT_TYPE_TO_TABLE[type] || type;
  if (!ALLOWED_TABLES.has(tableName)) {
    return { status: 'error', message: 'Invalid table name' };
  }

  // Cascade: many rows reference a trait_id; remove that trait too.
  const existing = await fetchData(tableName, [{ column: 'id', value: id }]);
  if (existing.length === 0) return { status: 'error', message: 'Content not found' };
  const row = existing[0];
  if (row.trait_id) {
    await deleteData('trait', row.trait_id).catch(() => {});
  }

  await deleteData(tableName, id);
  return { status: 'success', data: true };
});
