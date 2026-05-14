// Factory for /functions/v1/find-{thing} endpoints. Each one accepts a
// body keyed by user-visible names (e.g. `content_sources`) but the SQL
// columns are different (e.g. `content_source_id`), and some filters use
// case-insensitive ILIKE or array-contains semantics.
//
// Spec form: array of tuples. Each tuple is [bodyKey, columnName, options?].
//   options.ignoreCase    -> ILIKE on a varchar column
//   options.arrayContains -> @> on an array column
//   options.arrayType     -> cast for array-contains (e.g. 'bigint', 'text')

import { defineFunction, fetchData } from './_shared.mjs';

export function makeFinder(tableName, filterSpec) {
  return defineFunction(async (ctx) => {
    const body = ctx.body || {};
    const filters = filterSpec.map(([bodyKey, columnName, options]) => ({
      column: columnName,
      value: body[bodyKey],
      options,
    }));
    const rows = await fetchData(tableName, filters);
    const id = body.id;
    const data =
      id === undefined || id === null || Array.isArray(id)
        ? rows
        : rows.length > 0
          ? rows[0]
          : null;
    return { status: 'success', data };
  });
}
