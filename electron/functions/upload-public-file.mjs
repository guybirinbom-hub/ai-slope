// Upload a base64-encoded image to local storage and return its public URL.
// The original supabase function pushed to Supabase Storage; we write it to
// our on-disk storage shim under data/storage/uploads/{user_id}/{name}.{ext}
// and return a URL the frontend can fetch from the gateway.

import { defineFunction } from './_shared.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
// Honor WG_STORAGE_DIR (set by Electron's main.cjs when packaged so writes
// land in %AppData% instead of the read-only asar).
const STORAGE_ROOT = process.env.WG_STORAGE_DIR || path.join(ROOT, 'data', 'storage');

export default defineFunction(async (ctx) => {
  const user = await ctx.getUser();
  if (!user) return { status: 'error', message: 'User not found' };

  const { data, category, type } = ctx.body || {};
  if (!data) return { status: 'error', message: 'data required' };

  // Sanitize the extension and category so a malicious payload can't escape
  // the storage root.
  const ext = (type || 'png').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'png';
  const cat = (category || 'misc').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'misc';

  const bucket = 'uploads';
  const filename = `${crypto.randomUUID()}.${ext}`;
  const relPath = `${cat}/${user.user_id}/${filename}`;
  const fullPath = path.join(STORAGE_ROOT, bucket, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });

  const buf = Buffer.from(data, 'base64');
  writeFileSync(fullPath, buf);

  // URL the frontend can hit. Same gateway serves it via /storage/v1/object/
  // public/<bucket>/<path>. We return an absolute URL so <img src> works
  // regardless of the page's current path.
  const url = `http://localhost:9000/storage/v1/object/public/${bucket}/${relPath}`;
  return { status: 'success', data: { url } };
});
