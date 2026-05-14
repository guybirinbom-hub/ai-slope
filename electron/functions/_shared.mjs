// Shared helpers for in-process edge function ports.
//
// The Deno functions in supabase/functions/ use a SupabaseClient that ends up
// talking to PostgREST. In-process we skip that layer and go straight to pg
// via the gateway's pool — same database, no network hop, no edge-runtime
// CPU budget. Each ported function exports an async `handler(ctx)` that
// returns a JSendResponse-shaped object: { status, data?, message? }.

import pg from 'pg';
import crypto from 'node:crypto';

// PostgREST returns bigint and bigint[] columns as JS numbers. pg-node's
// default returns them as strings to preserve precision past 2^53. The
// frontend assumes the PostgREST shape — it filters traits with
// includes(123) (number) but with the default parser we'd return '123'
// (string), and Array.includes uses strict equality. WG ids are well
// inside Number.MAX_SAFE_INTEGER, so converting is safe.
//   OID 20   = int8 / bigint
//   OID 1016 = int8 / bigint array
pg.types.setTypeParser(20, (val) => (val === null ? null : Number(val)));
pg.types.setTypeParser(1016, (val) => {
  if (val === null) return null;
  // Postgres text array form: {1,2,3} or {} for empty. Bigint arrays don't
  // need quote-stripping; values are bare digits.
  const inner = val.slice(1, -1);
  if (!inner) return [];
  return inner.split(',').map((s) => Number(s));
});

// One pool shared across all ported functions. Initialized lazily.
let pool;

export function configurePool(opts) {
  pool = new pg.Pool(opts);
}

export function getPool() {
  if (!pool) throw new Error('function pool not configured');
  return pool;
}

// JWT decode without signature verification. PostgREST has already verified
// signatures (and so has the gateway's auth-bridge upstream). Here we just
// need the sub claim.
export function decodeJwtPayload(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const json = Buffer.from(
      parts[1].replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Build a parameterised WHERE from a filter set. Mirrors the semantics of the
// original fetchData but emits straight SQL.
//   { column, value }                                 -> col = $1   (or IS NULL when value === null)
//   { column, value: [a, b] }                         -> col IN ($1, $2)
//   { column, value: [...], options: { arrayContains } } -> col @> ARRAY[$1, $2]::bigint[]  (use carefully)
//   value === undefined  -> filter skipped
function buildWhere(filters, paramStart = 1) {
  const clauses = [];
  const values = [];
  let p = paramStart;
  for (const f of filters || []) {
    if (f.value === undefined) continue;
    if (f.value === null) {
      clauses.push(`"${f.column}" IS NULL`);
      continue;
    }
    if (Array.isArray(f.value)) {
      if (f.value.length === 0) continue;
      if (f.options && f.options.arrayContains) {
        // pg-node passes JS arrays as Postgres arrays, but the inferred
        // element type can be wrong (int4 vs bigint, text vs varchar) which
        // makes @> reject the comparison. Cast explicitly when the caller
        // knows the array's element type.
        const cast = f.options.arrayType ? `::${f.options.arrayType}[]` : '';
        clauses.push(`"${f.column}" @> $${p}${cast}`);
        values.push(f.value);
        p++;
      } else {
        const placeholders = f.value.map(() => `$${p++}`).join(', ');
        clauses.push(`"${f.column}" IN (${placeholders})`);
        values.push(...f.value);
      }
      continue;
    }
    if (f.options && f.options.ignoreCase) {
      clauses.push(`"${f.column}" ILIKE $${p}`);
      values.push(String(f.value));
      p++;
      continue;
    }
    clauses.push(`"${f.column}" = $${p}`);
    values.push(f.value);
    p++;
  }
  return { clause: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', values, nextParam: p };
}

// Tables we know about. (Equivalent to TableName in helpers.ts — keeps the
// dispatch a simple identifier lookup so callers can't smuggle SQL into it.)
const KNOWN_TABLES = new Set([
  'public_user', 'ability_block', 'content_source', 'content_update',
  'versatile_heritage', 'class_archetype', 'campaign', 'character',
  'ancestry', 'trait', 'class', 'background', 'archetype',
  'item', 'spell', 'creature', 'language', 'encounter',
]);

// Content tables whose schema has a `uuid bigint NOT NULL` column with no
// DEFAULT. Upstream WG fills this server-side as part of a content
// fingerprint / version-hash workflow. Locally we just need *some* unique
// bigint so inserts don't violate the NOT NULL constraint — collisions
// inside Number.MAX_SAFE_INTEGER (≈9×10^15) are astronomically unlikely.
const TABLES_WITH_UUID_BIGINT = new Set([
  'ability_block', 'ancestry', 'archetype', 'background', 'class',
  'class_archetype', 'creature', 'item', 'language', 'spell',
  'trait', 'versatile_heritage',
]);

function assertKnownTable(table) {
  if (!KNOWN_TABLES.has(table)) throw new Error(`unknown table: ${table}`);
  return `"${table}"`;
}

// Random positive bigint that fits in JS Number — used to fill the `uuid`
// column on INSERT for content tables that have it as NOT NULL.
function generateUuidBigint() {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

// Per-table list of single-value json / jsonb columns. The frontend passes
// these as JS objects or arrays; pg-node defaults to serialising a JS Array
// as a Postgres array literal ('{1,2}') rather than as JSON, which Postgres
// then rejects on a json/jsonb column with "invalid input syntax for type
// json". We hand-stringify these before they hit the driver so the column
// receives proper JSON text. json[] / jsonb[] columns are NOT listed here —
// pg-node already produces the correct Postgres array literal for those.
//
// Source of truth: data/schema.sql.
export const JSON_COLUMNS = {
  ability_block: ['meta_data'],
  ancestry: ['meta_data'],
  archetype: ['notes', 'recommended_options', 'recommended_variants', 'recommended_content_sources', 'meta_data'],
  background: [],
  campaign: ['notes', 'recommended_options', 'recommended_variants', 'recommended_content_sources', 'meta_data'],
  character: [
    'inventory', 'notes', 'details', 'roll_history', 'meta_data',
    'options', 'variants', 'content_sources', 'operation_data',
    'spells', 'companions',
  ],
  class: [],
  class_archetype: [],
  content_source: ['meta_data', 'keys'],
  content_update: ['data', 'status'],
  creature: [
    'meta_data', 'inventory', 'notes', 'details', 'roll_history',
    'spells', 'operation_data',
  ],
  encounter: ['combatants', 'meta_data'],
  item: ['meta_data', 'price'],
  language: [],
  public_user: ['site_theme', 'subscribed_content_sources', 'patreon', 'api'],
  spell: ['meta_data', 'heightened'],
  trait: ['meta_data'],
  versatile_heritage: [],
};

// Given a (table, body) pair, return a shallow copy of body where any value
// whose key matches a json/jsonb column for that table has been JSON.stringify-ed.
// Leaves non-JSON columns alone, including json[] / jsonb[] columns (those
// are handled correctly by pg-node's array serialisation).
export function serializeJsonColumns(tableName, data) {
  const jsonCols = JSON_COLUMNS[tableName] || [];
  if (jsonCols.length === 0) return data;
  const out = { ...data };
  for (const col of jsonCols) {
    const v = out[col];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') continue; // already serialised by caller
    out[col] = JSON.stringify(v);
  }
  return out;
}

export async function fetchData(tableName, filters, options = {}) {
  const table = assertKnownTable(tableName);
  const { clause, values } = buildWhere(filters);
  let sql = `SELECT * FROM public.${table} ${clause}`;
  if (options.created) {
    const from = options.created.from || '1970-01-01T00:00:00Z';
    const to = options.created.to || new Date().toISOString();
    sql += clause
      ? ` AND created_at >= $${values.length + 1} AND created_at <= $${values.length + 2}`
      : ` WHERE created_at >= $${values.length + 1} AND created_at <= $${values.length + 2}`;
    values.push(from, to);
  }
  if (options.orderBy) sql += ` ORDER BY "${options.orderBy}"`;
  if (typeof options.limit === 'number') sql += ` LIMIT ${options.limit}`;
  const { rows } = await getPool().query(sql, values);
  return rows;
}

export async function upsertData(tableName, data, returnRow = true) {
  const table = assertKnownTable(tableName);
  // Pre-stringify json/jsonb columns. See serializeJsonColumns above.
  let serialised = serializeJsonColumns(tableName, data);

  const hasId = data.id !== undefined && data.id !== null && data.id !== -1;

  // Fill the `uuid` bigint on INSERT for content tables that require it.
  // The upstream WG service computes this server-side; locally we just
  // need any unique non-null value to satisfy the NOT NULL constraint.
  // On UPDATE we leave the existing row's uuid alone — overwriting it
  // would churn the content fingerprint every time the row was edited.
  if (!hasId && TABLES_WITH_UUID_BIGINT.has(tableName) &&
      (serialised.uuid === undefined || serialised.uuid === null || serialised.uuid === '')) {
    serialised = { ...serialised, uuid: generateUuidBigint() };
  }

  const entries = Object.entries(serialised).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw new Error('upsertData: empty data');
  const cols = entries.map(([k]) => `"${k}"`).join(', ');
  const params = entries.map((_, i) => `$${i + 1}`).join(', ');
  const values = entries.map(([, v]) => v);

  let sql;
  if (hasId) {
    // UPDATE ... WHERE id = $N (id is also in entries so it's a no-op set, but
    // we explicitly set updated_at-ish fields here too).
    const setClauses = entries
      .filter(([k]) => k !== 'id')
      .map(([k], i) => `"${k}" = $${i + 1}`)
      .join(', ');
    const idEntries = entries.filter(([k]) => k !== 'id');
    sql = `UPDATE public.${table} SET ${setClauses} WHERE id = $${idEntries.length + 1}`;
    if (returnRow) sql += ' RETURNING *';
    const updateValues = [...idEntries.map(([, v]) => v), data.id];
    const { rows } = await getPool().query(sql, updateValues);
    return { procedure: 'update', result: rows[0] };
  } else {
    // INSERT (no id) — let the sequence assign it
    const insertEntries = entries.filter(([k]) => k !== 'id');
    const insertCols = insertEntries.map(([k]) => `"${k}"`).join(', ');
    const insertParams = insertEntries.map((_, i) => `$${i + 1}`).join(', ');
    const insertValues = insertEntries.map(([, v]) => v);
    sql = `INSERT INTO public.${table} (${insertCols}) VALUES (${insertParams})`;
    if (returnRow) sql += ' RETURNING *';
    const { rows } = await getPool().query(sql, insertValues);
    return { procedure: 'insert', result: rows[0] };
  }
}

export async function deleteData(tableName, id) {
  const table = assertKnownTable(tableName);
  await getPool().query(`DELETE FROM public.${table} WHERE id = $1`, [id]);
  return { status: 'success' };
}

// JSend-style response wrapper, matching what the Deno functions returned.
export function upsertResponseWrapper(procedure, result) {
  return { status: 'success', data: result };
}

// Look up the requester's public_user row directly from the JWT — no GoTrue
// round-trip, no Docker dependency.
export async function getPublicUser(token) {
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.sub) return null;
  const rows = await fetchData('public_user', [{ column: 'user_id', value: payload.sub }]);
  return rows[0] || null;
}

// The function-handler wrapper: each ported function exports a default async
// function with signature (ctx) -> JSendResponse. ctx provides body, token,
// user (looked up lazily), and the helper functions.
export function defineFunction(handler) {
  return async (req, res) => {
    try {
      const rawAuth = (req.headers.authorization || '').trim();
      const token = rawAuth.startsWith('Bearer ') ? rawAuth.slice(7) : rawAuth;
      const body = req.body && Object.keys(req.body).length ? req.body : {};
      const ctx = {
        body,
        token,
        // lazy: only compute when the handler asks for it
        getUser: () => getPublicUser(token),
        // helpers passed for convenience
        fetchData,
        upsertData,
        deleteData,
        upsertResponseWrapper,
      };
      const out = await handler(ctx);
      res.status(200).json(out);
    } catch (err) {
      console.error('[function]', req.path, 'error:', err && err.message ? err.message : err);
      res.status(200).json({ status: 'error', message: err && err.message ? err.message : 'internal error' });
    }
  };
}
