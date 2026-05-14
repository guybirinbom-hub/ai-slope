// Port of supabase/functions/get-user/index.ts
//
// If id/_id provided, fetch the named user. Otherwise the requester's own.
// Same shape as the Deno version: { status: 'success', data: PublicUser }
// or { status: 'error', message }.

import { defineFunction, fetchData, getPublicUser } from './_shared.mjs';

function redactSensitive(user) {
  if (!user) return user;
  if (user.api && Array.isArray(user.api.clients)) {
    for (const c of user.api.clients) c.api_key = '<SECRET>';
  }
  if (user.patreon) {
    user.patreon = { ...user.patreon };
    for (const k of ['access_token', 'refresh_token', 'patreon_name', 'patreon_email', 'patreon_user_id']) {
      if (k in user.patreon) user.patreon[k] = '<SECRET>';
    }
    if (user.patreon.game_master) {
      user.patreon.game_master = { ...user.patreon.game_master, access_code: '<SECRET>' };
    }
  }
  return user;
}

export default defineFunction(async (ctx) => {
  const { id, _id } = ctx.body;

  if (id || _id) {
    const filters = [];
    if (_id !== undefined) filters.push({ column: 'id', value: _id });
    if (id !== undefined) filters.push({ column: 'user_id', value: id });
    const results = await fetchData('public_user', filters);
    if (results.length === 0) return { status: 'error', message: 'User not found' };
    return { status: 'success', data: redactSensitive(results[0]) };
  }

  const user = await ctx.getUser();
  if (!user) return { status: 'error', message: 'User not found' };
  return { status: 'success', data: user };
});
