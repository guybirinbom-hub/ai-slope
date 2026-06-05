import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, rmSync } from 'node:fs';
const dir = process.env.T;
try { rmSync(dir, { recursive: true, force: true }); } catch {}
const pg = new EmbeddedPostgres({
  databaseDir: dir, port: 59991, user: 'postgres', password: 'x',
  authMethod: 'password', persistent: true,
  initdbFlags: ['--encoding=UTF8','--locale=C'],
  onLog: l => console.log('[log]', String(l).split('\n')[0].slice(0,140)),
  onError: e => console.error('[err]', String(e).split('\n')[0].slice(0,200)),
});
const t0 = Date.now();
let outcome = 'pending';
const init = pg.initialise().then(()=>outcome='resolved').catch(e=>outcome='rejected: '+e.message);
await Promise.race([init, new Promise(r=>setTimeout(r,20000))]);
console.log('after ~'+(Date.now()-t0)+'ms  initialise='+outcome);
console.log('postgresql.conf:', existsSync(dir+'/postgresql.conf'), ' PG_VERSION:', existsSync(dir+'/PG_VERSION'));
process.exit(0);
