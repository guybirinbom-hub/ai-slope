// GM group is empty (no Patreon, no multiplayer). Return an empty user list.
import { defineFunction } from './_shared.mjs';
export default defineFunction(async () => ({ status: 'success', data: [] }));
