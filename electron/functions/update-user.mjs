// Updates the requester's public_user row with allowed fields only.
// Mirrors the original Deno function's field whitelist.

import { defineFunction, getPool, serializeJsonColumns } from './_shared.mjs';

const ALLOWED = [
  'display_name',
  'summary',
  'image_url',
  'background_image_url',
  'organized_play_id',
  'site_theme',
  'subscribed_content_sources',
  'api',
];

export default defineFunction(async (ctx) => {
  const user = await ctx.getUser();
  if (!user) return { status: 'error', message: 'User not found' };

  // public_user has several json/jsonb columns (site_theme, subscribed_content_sources,
  // patreon, api). Pre-stringify so pg-node sends them as proper JSON text
  // rather than as Postgres array literals.
  const body = serializeJsonColumns('public_user', ctx.body || {});

  const sets = [];
  const values = [];
  let p = 1;
  for (const k of ALLOWED) {
    if (k in body) {
      sets.push(`"${k}" = $${p++}`);
      values.push(body[k]);
    }
  }
  if (sets.length === 0) return { status: 'success', data: true };
  values.push(user.id);
  await getPool().query(
    `UPDATE public.public_user SET ${sets.join(', ')} WHERE id = $${p}`,
    values
  );
  return { status: 'success', data: true };
});
