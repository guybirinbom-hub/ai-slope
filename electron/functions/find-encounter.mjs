// Encounters are part of the stripped campaign feature; empty list.
import { defineFunction } from './_shared.mjs';
export default defineFunction(async (ctx) => {
  if ('id' in ctx.body && !Array.isArray(ctx.body.id)) {
    return { status: 'success', data: null };
  }
  return { status: 'success', data: [] };
});
