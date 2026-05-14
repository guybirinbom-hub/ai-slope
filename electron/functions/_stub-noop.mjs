// Catch-all stub for functions we don't intend to support in the local fork
// (campaign multiplayer, GM groups, Patreon OAuth, AI/vector features).
// Returns a JSendResponse success with null so the frontend doesn't error.

import { defineFunction } from './_shared.mjs';
export const noop = defineFunction(async () => ({ status: 'success', data: null }));
