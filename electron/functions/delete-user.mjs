// In a single-user PC install there is no "delete my account" — the user IS
// the install. Pretend success.
import { defineFunction } from './_shared.mjs';
export default defineFunction(async () => ({ status: 'success', data: true }));
