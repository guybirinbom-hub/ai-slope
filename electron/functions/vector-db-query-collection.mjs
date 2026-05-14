// Vector search disabled — return empty hits so any UI that uses it
// (typically AI-driven recommendations) degrades to "no results".
import { defineFunction } from './_shared.mjs';
export default defineFunction(async () => ({ status: 'success', data: [] }));
