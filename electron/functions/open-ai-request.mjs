// AI suggestions disabled in the local fork.
import { defineFunction } from './_shared.mjs';
export default defineFunction(async () => ({
  status: 'error',
  message: 'AI features are disabled in the local fork',
}));
