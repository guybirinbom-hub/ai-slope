// Idempotently patches @embedded-postgres/windows-x64 so its exported
// binary paths are asar-unpacked-aware in packaged Electron builds.
// Run from npm postinstall so a fresh `npm install` doesn't undo the fix.

const fs = require('fs');
const path = require('path');

const target = path.resolve(
  __dirname, '..', 'node_modules', '@embedded-postgres', 'windows-x64', 'dist', 'index.js'
);
if (!fs.existsSync(target)) {
  // Platform package not installed (non-Windows dev box); nothing to patch.
  process.exit(0);
}

const patched = `import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function unpackPath(p) {
    return p.replace(/([\\\\/])app\\.asar([\\\\/])/, '$1app.asar.unpacked$2');
}
export const pg_ctl = unpackPath(path.resolve(__dirname, '..', 'native', 'bin', 'pg_ctl.exe'));
export const initdb = unpackPath(path.resolve(__dirname, '..', 'native', 'bin', 'initdb.exe'));
export const postgres = unpackPath(path.resolve(__dirname, '..', 'native', 'bin', 'postgres.exe'));
`;

const current = fs.readFileSync(target, 'utf8');
if (current === patched) {
  // Already patched, nothing to do.
  process.exit(0);
}
fs.writeFileSync(target, patched, 'utf8');
console.log('[patch-embedded-postgres] patched', target);
