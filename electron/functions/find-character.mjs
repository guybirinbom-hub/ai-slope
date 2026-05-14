// Port of supabase/functions/find-character/index.ts
//
// Filters: id (number or array), user_id, campaign_id. Returns one character
// if id is a scalar, or a sorted array otherwise.

import { defineFunction, fetchData } from './_shared.mjs';

export default defineFunction(async (ctx) => {
  const { id, user_id, campaign_id } = ctx.body;
  const results = await fetchData('character', [
    { column: 'id', value: id },
    { column: 'user_id', value: user_id },
    { column: 'campaign_id', value: campaign_id },
  ]);

  if (id !== undefined && id !== null && !Array.isArray(id)) {
    return { status: 'success', data: results[0] };
  }
  return { status: 'success', data: results.sort((a, b) => a.id - b.id) };
});
