// Port of supabase/functions/create-character/index.ts
//
// Local fork: Patreon slot caps are removed (we hardcoded hasPatreonAccess
// to true elsewhere). New characters get inserted under the requester's
// user_id from the JWT.

import { defineFunction, upsertData, upsertResponseWrapper } from './_shared.mjs';

export default defineFunction(async (ctx) => {
  const user = await ctx.getUser();
  if (!user) return { status: 'error', message: 'User not found' };

  const c = ctx.body || {};
  const { procedure, result } = await upsertData('character', {
    id: c.id,
    user_id: user.user_id,
    name: c.name,
    level: c.level,
    experience: c.experience,
    hp_current: c.hp_current,
    hp_temp: c.hp_temp,
    hero_points: c.hero_points,
    stamina_current: c.stamina_current,
    resolve_current: c.resolve_current,
    inventory: c.inventory,
    notes: c.notes,
    details: c.details,
    roll_history: c.roll_history,
    custom_operations: c.custom_operations,
    meta_data: c.meta_data,
    options: c.options,
    variants: c.variants,
    content_sources: c.content_sources,
    operation_data: c.operation_data,
    spells: c.spells,
    companions: c.companions,
    campaign_id: c.campaign_id,
  });

  return upsertResponseWrapper(procedure, result);
});
