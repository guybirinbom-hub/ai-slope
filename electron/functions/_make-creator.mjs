// Factory for /functions/v1/create-{thing} endpoints. Each one upserts a row
// into its table with the body fields (passes all received fields through to
// upsertData, which routes to INSERT vs UPDATE based on whether id is set).
//
// Upstream WG's frontend ships every Create*Modal with `created_at: ''` and
// `user_id: ''` sentinels meaning "let the server fill this in." Supabase's
// PostgREST insert layer drops empty strings before they reach Postgres; our
// raw pg-pool path doesn't, so empty strings hit `timestamptz` and `uuid`
// columns and Postgres rejects them ("invalid input syntax for type
// timestamp with time zone: \"\""). We strip those sentinels here so call
// sites can keep using the upstream pattern.

import { defineFunction, upsertData, upsertResponseWrapper } from './_shared.mjs';

// Columns we never let an empty string reach Postgres for. created_at and
// updated_at have DEFAULT NOW() in the schema; clearing the empty string
// lets that fire. user_id we either backfill from the JWT (for tables that
// have one) or strip entirely.
const STRIP_EMPTY_COLS = ['created_at', 'updated_at'];

// Tables that have a user_id column we should auto-fill from the JWT when
// the caller didn't provide one.
const USER_OWNED_TABLES = new Set([
  'content_source',
  'character',
  'campaign',
  'encounter',
]);

export function makeCreator(tableName) {
  return defineFunction(async (ctx) => {
    const body = { ...(ctx.body || {}) };

    // Drop empty-string sentinels for date/time columns.
    for (const col of STRIP_EMPTY_COLS) {
      if (body[col] === '' || body[col] === null) {
        delete body[col];
      }
    }

    // For user-owned tables, backfill user_id from the JWT when not set.
    if (USER_OWNED_TABLES.has(tableName)) {
      if (!body.user_id || body.user_id === '') {
        const user = await ctx.getUser();
        if (user && user.user_id) {
          body.user_id = user.user_id;
        } else {
          // Without a JWT user the insert would fail with a NOT NULL
          // violation. Strip so the caller gets a clearer error.
          delete body.user_id;
        }
      }
    }

    const { procedure, result } = await upsertData(tableName, body);
    return upsertResponseWrapper(procedure, result);
  });
}
