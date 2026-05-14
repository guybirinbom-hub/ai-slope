// Port of supabase/functions/update-character/index.ts (delta update).
//
// Frontend posts a partial character payload; we upsert with id present so
// it becomes an UPDATE under the hood.

import { defineFunction, upsertData, upsertResponseWrapper } from './_shared.mjs';

export default defineFunction(async (ctx) => {
  const user = await ctx.getUser();
  if (!user) return { status: 'error', message: 'User not found' };

  const c = ctx.body || {};
  if (!c.id) return { status: 'error', message: 'character id required' };

  const { procedure, result } = await upsertData('character', {
    id: c.id,
    user_id: user.user_id,
    ...c,
  });
  return upsertResponseWrapper(procedure, result);
});
