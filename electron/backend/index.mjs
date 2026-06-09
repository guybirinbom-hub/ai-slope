// Local backend orchestrator: embedded Postgres + bundled PostgREST.
// Goal of Phase 2: stand these up outside of Docker so /rest/v1/* works
// against an in-process database. Auth/storage/functions still come from
// Docker for now; later phases replace each.

import EmbeddedPostgres from 'embedded-postgres';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, createReadStream, readdirSync, statSync, unlinkSync, writeFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import pg from 'pg';
import crypto from 'node:crypto';
import net from 'node:net';

// Poll a TCP port until something is accepting connections on it, or
// the timeout elapses. Used to detect when pg is actually up so we
// don't sit forever inside pgEmbedded.start() if its pg_ctl-based
// readiness detection sticks. Resolves when the port accepts a
// connection; rejects on timeout.
function waitForPgPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const sock = net.connect({ host: '127.0.0.1', port });
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        try { sock.destroy(); } catch {}
        if (ok) return resolve();
        if (Date.now() > deadline) return reject(new Error(`pg port ${port} not reachable within ${timeoutMs}ms`));
        setTimeout(attempt, 250);
      };
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
      // Belt-and-braces — connect() with no response just sits; cap.
      setTimeout(() => done(false), 1000);
    };
    attempt();
  });
}

// Wait until pg is past crash-recovery / startup and actually ready
// to answer queries. Probe by attempting a SELECT 1 — if pg replies
// with SQLSTATE 57P03 ("the database system is starting up") it's
// still doing WAL replay / fsync; retry. Any other error (connection
// refused, auth failure) we just back off and try again until the
// timeout. Resolves on the first successful SELECT 1.
//
// IMPORTANT: every failed probe spawns a postgres backend that has to
// initialise just to be told "system starting up" and exit. Probing
// too aggressively slows the actual recovery. We start at 200ms but
// back off hard once we see the first 57P03 — recovery on a populated
// data dir routinely runs 60-90s on Windows.
// Spawn postgres.exe directly + wait for the port to open. Bypasses
// pgEmbedded.start() which on this Windows build silently rejects with
// `undefined` and never actually launches postgres. Also pre-cleans
// any stale postmaster.pid in the data dir so a previous run's
// orphan-lock doesn't block our new postgres.
async function runPostgresDirect(dataDir, port) {
  // Pre-spawn cleanup. We spawn postgres with `detached: true` (see
  // comment near the spawn() call below) because without it PG's
  // postmaster.pid file is never written, which causes PG's periodic
  // lock-file check to self-shutdown the cluster ~60s after start.
  // The price of `detached: true` is that postgres SURVIVES if the
  // Electron parent dies abnormally (force-quit, Task Manager End
  // Task, OS reboot mid-session). Next launch then sees the old pg
  // still holding the data dir lock and bails with "lock file
  // postmaster.pid already exists".
  //
  // So before spawning OUR postgres we aggressively clean:
  //   1. Read postmaster.pid (if it exists) for its claimed pid.
  //   2. Force-kill that PID + its descendants via taskkill — this is
  //      safe because the Electron single-instance-lock (see
  //      main.cjs) guarantees there's no other WG running, so any
  //      postgres still holding this data dir's lock IS by definition
  //      a previous-crashed-WG orphan.
  //   3. Also blanket-kill any postgres.exe / postgrest.exe in the
  //      user's session (we don't need surgical PID matching — anyone
  //      else's postgres should be running as a Windows service in
  //      session 0, which we don't touch).
  //   4. Delete postmaster.pid + postmaster.opts so the new pg sees
  //      a virgin lock state.
  const pidFile = path.join(dataDir, 'postmaster.pid');
  const optsFile = path.join(dataDir, 'postmaster.opts');
  // Step 1+2: targeted kill from pid file
  if (existsSync(pidFile)) {
    try {
      const raw = readFileSync(pidFile, 'utf8').split(/\r?\n/, 1)[0];
      const pid = Math.abs(parseInt(raw, 10));
      if (Number.isFinite(pid) && pid > 0) {
        try {
          execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
            stdio: 'ignore', timeout: 3000, windowsHide: true,
          });
          console.log('[pg] killed leftover postmaster pid=' + pid + ' from previous run');
        } catch { /* already dead or different owner */ }
      }
    } catch {}
  }
  // Step 3: blanket kill any remaining user-session postgres/postgrest.
  // taskkill exits non-zero with "no process matches" — harmless.
  for (const image of ['postgres.exe', 'postgrest.exe']) {
    try {
      execFileSync('taskkill', ['/F', '/IM', image], {
        stdio: 'ignore', timeout: 3000, windowsHide: true,
      });
    } catch {}
  }
  // Step 4: remove lock files unconditionally. If a real postgres is
  // running on this data dir it's dead by now (step 2+3 killed it);
  // its lock file is by definition stale.
  for (const f of [pidFile, optsFile]) {
    try { if (existsSync(f)) unlinkSync(f); } catch {}
  }

  const postgresBin = path.join(config.pgBinDir, 'postgres.exe');
  console.log('[pg] spawning postgres directly:', postgresBin, '-D', dataDir, '-p', port);
  // Performance flags — without these, the FIRST postgres boot on
  // Windows spends 60-120s doing an initial fsync of every file initdb
  // wrote, because Windows treats the data dir as untrusted (antivirus
  // scans each WAL/heap file as postgres opens it). We disable fsync
  // + synchronous_commit for our embedded use case. Trade-off: a power
  // cut would lose the last few seconds of writes — acceptable for a
  // single-user desktop app that auto-saves on graceful close.
  //
  // Spawn config mirrors what `embedded-postgres` (the library we
  // bypass) does on Windows: default pipe stdio so we can listen for
  // stderr log lines, no `windowsHide`, no `cwd`. Previous variant
  // used `stdio: ['ignore', outFd, errFd]` + `windowsHide: true` +
  // `cwd: pgBinDir`. With THAT combination, postgres opened its
  // listening ports + accepted queries — but never created its own
  // postmaster.pid file. PG's periodic lock-file check then triggered
  // an "immediate shutdown because data directory lock file is
  // invalid" about 45 seconds after start, killing the cluster mid-
  // session and stranding the user with a "loading…" screen on any
  // followup query. Default pipe stdio fixes it; the cost is we have
  // to consume the pipe to avoid backpressure → we tee stderr lines
  // to the log file in JS and ignore stdout.
  const logDir = path.join(dataDir, 'wg-log');
  try { mkdirSync(logDir, { recursive: true }); } catch {}
  const stderrLogPath = path.join(logDir, 'postgres-stderr.log');
  const fsMod = await import('node:fs');
  const stderrLogStream = fsMod.createWriteStream(stderrLogPath, { flags: 'a' });
  // Spawn postgres with no special options (windowsHide so any
  // incidental console doesn't pop up — `detached: true` would force
  // a visible console per worker on Windows, which is unusable).
  //
  // CRITICAL Windows-Electron quirk: when postgres.exe is spawned from
  // Node's child_process inside an Electron app, IT NEVER WRITES its
  // own `postmaster.pid` file. PG starts, listens, answers queries —
  // but its periodic "is my lock file valid?" check then fires
  // "performing immediate shutdown because data directory lock file is
  // invalid" about 60 seconds after start, killing the cluster mid-
  // session. The user sees their character-creation request hang
  // forever because postgres died under it.
  //
  // The same postgres.exe with the same flags written from BASH writes
  // postmaster.pid correctly. We've ruled out: cwd, windowsHide, stdio
  // pipe vs ignore vs inherit, env vars, args. The only spawn option
  // that makes PG write the pid is `detached: true` — which on Windows
  // means a new console per process and is unusable for our purposes.
  //
  // Workaround: spawn normally + WRITE the postmaster.pid file
  // ourselves after the postmaster is up. PG's periodic lock-file
  // check just reads line 1 and verifies it's the postmaster's PID —
  // it doesn't care who created the file. We get the PID from
  // `proc.pid`, fill in the other lines per the PG-18 format, and
  // call it done.
  const proc = spawn(
    postgresBin,
    [
      '-D', dataDir,
      '-p', String(port),
      '-c', 'fsync=off',
      '-c', 'synchronous_commit=off',
      '-c', 'full_page_writes=off',
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  // Pipe stderr to the log file so we still have the diagnostic stream
  // for the user-visible error overlay (readStderrTail below). We
  // intentionally don't pipe stdout — it's chatty and we don't need it.
  if (proc.stderr) proc.stderr.pipe(stderrLogStream);
  if (proc.stdout) proc.stdout.resume(); // drain to /dev/null

  // Stash everything we need to write the lock file later. The actual
  // write happens after we confirm port-up so that we're writing the
  // file for a postmaster that's genuinely running.
  const postmasterPid = proc.pid;
  const writePostmasterPidFile = () => {
    try {
      // PG-18 postmaster.pid format (8 lines):
      //   1: postmaster PID
      //   2: data directory absolute path (forward slashes on Windows)
      //   3: postmaster start time, unix epoch seconds
      //   4: port
      //   5: socket directory (empty on Windows — PG uses TCP only)
      //   6: first listen_addresses value (or "*")
      //   7: shared memory key (0 on Windows — uses named segments)
      //   8: status flags char block (PG checks length not content)
      const startEpoch = Math.floor(Date.now() / 1000);
      const lines = [
        String(postmasterPid),
        dataDir.replace(/\\/g, '/'),
        String(startEpoch),
        String(port),
        '',          // socket dir — none on Windows
        'localhost', // listen address
        '   0   0',  // shared mem key + ID (Windows uses 0)
        'ready',     // status
      ];
      writeFileSync(pidFile, lines.join('\n') + '\n');
      console.log('[pg] wrote postmaster.pid with pid=' + postmasterPid + ' (Node-spawned pg does not write it itself on Windows)');
    } catch (err) {
      console.error('[pg] failed to write postmaster.pid:', err && err.message);
    }
  };
  // Track postmaster so the codebase's existing stop() path can kill it.
  pgPostmasterProc = proc;
  let exited = false;
  proc.on('exit', (code) => {
    exited = true;
    if (code !== 0 && !stopping) {
      console.error('[pg] postmaster exited unexpectedly code=' + code);
    }
  });
  proc.on('error', (err) => {
    exited = true;
    console.error('[pg] postmaster spawn error:', err && err.message);
  });

  // Read tail of the stderr log file. Used in error messages so the user
  // sees the actual postgres failure reason, not a generic timeout.
  const readStderrTail = () => {
    try {
      const f = path.join(logDir, 'postgres-stderr.log');
      if (!existsSync(f)) return '';
      const buf = readFileSync(f, 'utf8');
      return buf.slice(-4000);
    } catch { return ''; }
  };

  // Race port-up vs early-exit. If postgres dies during startup (port in
  // use, corrupt data dir), throw a useful message instead of waiting
  // 60s for a port that will never open.
  const tStart = Date.now();
  while (Date.now() - tStart < 60_000) {
    if (exited) {
      throw new Error(`postgres exited during startup. stderr: ${readStderrTail() || '(none)'}`);
    }
    const open = await new Promise((resolve) => {
      const s = net.createConnection({ host: '127.0.0.1', port }, () => {
        s.end();
        resolve(true);
      });
      s.on('error', () => resolve(false));
      s.setTimeout(500, () => { s.destroy(); resolve(false); });
    });
    if (open) {
      console.log('[pg] port', port, 'open after', Date.now() - tStart, 'ms');
      // Write the postmaster.pid file ourselves now that we've
      // confirmed pg is up. See the spawn() block above for why this
      // is necessary (Node-spawned pg on Windows doesn't write it).
      writePostmasterPidFile();
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  try { proc.kill('SIGKILL'); } catch {}
  throw new Error(`postgres port ${port} never opened in 60s. stderr: ${readStderrTail() || '(none)'}`);
}

// Poll the data dir for files initdb writes at the END of its run, so
// we can proceed even when initdb.exe finished its work but its child
// 'exit' event never fires (Windows stdio bug in embedded-postgres'
// spawn options). Returns as soon as PG_VERSION + postgresql.conf +
// pg_hba.conf are all present — the cluster is bootable at that point.
async function waitForInitdbDone(dataDir, timeoutMs) {
  const sentinels = ['PG_VERSION', 'postgresql.conf', 'pg_hba.conf'];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = sentinels.every((n) => existsSync(path.join(dataDir, n)));
    if (ok) {
      // 250ms cushion so initdb has time to flush its final writes
      // before postgres.exe tries to read the config.
      await new Promise((r) => setTimeout(r, 250));
      console.log('[pg] initdb sentinel files present — proceeding');
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`initdb didn't produce sentinel files within ${timeoutMs}ms`);
}

async function waitForPgReady(timeoutMs) {
  const { Client } = pg;
  const deadline = Date.now() + timeoutMs;
  let waitMs = 200;
  let seenRecovering = false;
  while (Date.now() < deadline) {
    const client = new Client({
      host: '127.0.0.1',
      port: config.pgPort,
      user: config.pgUser,
      password: config.pgPassword,
      database: 'postgres',
      // Short connection timeout so we don't sit on a half-open socket
      // when pg is still mid-recovery and refusing handshake.
      connectionTimeoutMillis: 2000,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (err) {
      try { await client.end(); } catch {}
      const code = err && err.code;
      if (code === '57P03') {
        // Crash recovery in progress. Back off harder so we don't
        // spawn-and-kill a postgres backend every 200ms.
        if (!seenRecovering) {
          console.log('[pg] crash recovery in progress, this may take 60-90s on a populated DB...');
          seenRecovering = true;
        }
        waitMs = 3000;
      } else {
        console.log('[pg] waiting for ready, transient error:', code ?? err.message);
        waitMs = Math.min(waitMs * 1.5, 2000);
      }
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error(`pg not ready for queries within ${timeoutMs}ms`);
}

// Send a clean shutdown (fast mode) via pg_ctl. Fast mode disconnects
// clients then performs an orderly shutdown of the postmaster, so the
// NEXT boot doesn't need crash recovery + fsync. Different from
// pgEmbedded.stop() because we drive pg_ctl directly with an explicit
// data dir + mode, which works even when pgEmbedded's internal state
// is confused. Returns a promise that resolves when pg_ctl exits;
// caller should race with a timeout.
function pgCtlStopFast() {
  return new Promise((resolve) => {
    try {
      const pgCtl = path.join(config.pgBinDir, 'pg_ctl.exe');
      if (!existsSync(pgCtl)) return resolve();
      const child = spawn(pgCtl, ['stop', '-D', config.pgDataDir, '-m', 'fast', '-w', '-t', '15'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('exit', () => resolve());
      child.on('error', () => resolve());
    } catch {
      resolve();
    }
  });
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export const config = {
  pgPort: Number(process.env.WG_PG_PORT) || 54422,
  pgUser: 'postgres',
  pgPassword: 'wglocal',
  pgDataDir: process.env.WG_PG_DATA || path.join(ROOT, 'data', 'embedded-pg'),
  postgrestPort: Number(process.env.WG_POSTGREST_PORT) || 3001,
  postgrestBin: process.env.WG_POSTGREST_BIN || path.join(ROOT, 'electron', 'bin', 'postgrest.exe'),
  pgBinDir: process.env.WG_PG_BIN_DIR || path.join(ROOT, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin'),
  storageDir: process.env.WG_STORAGE_DIR || path.join(ROOT, 'data', 'storage'),
  schemaSqlPath: process.env.WG_SCHEMA_SQL || path.join(ROOT, 'data', 'schema.sql'),
  dataSqlPath: process.env.WG_DATA_SQL || path.join(ROOT, 'data', 'data.sql'),
  // Gateway: single port the frontend hits. Phase 2.5 routes /rest/v1/* to our
  // embedded PostgREST and forwards everything else to Docker's kong on 8000.
  // Subsequent phases replace each kong route with an in-process handler.
  gatewayPort: Number(process.env.WG_GATEWAY_PORT) || 9000,
  kongUrl: process.env.WG_KONG_URL || 'http://localhost:8000',
  // Same secret used by Docker's .env so JWTs from there validate here too
  jwtSecret: 'tpTsNWDCSUHgYXKDLmg9xD8aUoUl2jSAnIA1I4Ox',
  // Fixed user id for the single local user. We seed a public_user row for
  // this id during migration so the app's "look up my profile" calls succeed.
  localUserId: '00000000-0000-0000-0000-000000000001',
};

// pg_dump 16 emits \restrict / \unrestrict directives that psql 15 doesn't
// understand. They're meta-commands meant to gate partial-application of a
// dump in a transaction; safe to drop for our use.
function stripRestrict(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\\(restrict|unrestrict)\s/.test(line))
    .join('\n');
}

// Splits data.sql into a sequence of operations:
//   { kind: 'sql',  text: '...' }   plain SQL to run via client.query
//   { kind: 'copy', table: 'public.foo (col1, col2)', rows: '...' }
// The COPY blocks in pg_dump output look like:
//     COPY public.tablename (cols...) FROM stdin;
//     <tab-separated rows>
//     \.
function parseDataDump(sql) {
  const lines = sql.split(/\r?\n/);
  const ops = [];
  let mode = 'sql';
  let buf = [];
  let copyHeader = null;

  for (const line of lines) {
    if (mode === 'sql') {
      const m = line.match(/^COPY\s+(.+)\s+FROM\s+stdin;\s*$/i);
      if (m) {
        if (buf.length) ops.push({ kind: 'sql', text: buf.join('\n') });
        buf = [];
        copyHeader = m[1];
        mode = 'copy';
      } else {
        buf.push(line);
      }
    } else {
      if (line === '\\.') {
        // Skip empty COPY blocks (e.g. tables with no data in the dump).
        // Otherwise we'd send "\n" which Postgres reads as one empty row.
        if (buf.length && !(buf.length === 1 && buf[0] === '')) {
          ops.push({ kind: 'copy', table: copyHeader, rows: buf.join('\n') + '\n' });
        }
        buf = [];
        copyHeader = null;
        mode = 'sql';
      } else {
        buf.push(line);
      }
    }
  }
  if (buf.length) ops.push({ kind: 'sql', text: buf.join('\n') });
  return ops;
}

// Roles referenced by schema.sql GRANTs and by PostgREST. We create them
// up-front so the schema apply doesn't error on unknown grantees. Real
// Supabase creates these via auth init scripts; we don't run those.
//
// Also: schema.sql's RLS policies reference auth.uid()/auth.role()/auth.email()
// which Supabase ships in its 'auth' schema. We stub minimal versions that read
// from the request.jwt.claims GUC (PostgREST sets that on every authenticated
// request). Same contract Supabase exposes — RLS policies don't need to change.
const ROLE_BOOTSTRAP_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN
    CREATE ROLE authenticator LOGIN PASSWORD 'wglocal' NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='github') THEN
    CREATE ROLE github NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
-- PostgREST runs schema-cache introspection as the authenticator role itself
-- (not as the role it switches to per-request). Granting pg_read_all_data
-- lets that introspection see the public schema's tables. Postgres built-in
-- predefined role.
GRANT pg_read_all_data TO authenticator;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Minimal stub of GoTrue's users table so the FK constraints schema.sql
-- creates against auth.users(id) succeed. We don't enforce these FKs at
-- data-load time (see session_replication_role below) and the column set
-- here is intentionally minimal.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
GRANT SELECT ON auth.users TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT current_setting('request.jwt.claims', true)::json->>'role';
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT current_setting('request.jwt.claims', true)::json->>'email';
$$;
`;

async function runFirstBootMigrations(client) {
  console.log('[migrate] applying schema.sql...');
  const schema = stripRestrict(readFileSync(config.schemaSqlPath, 'utf8'));
  await client.query(schema);

  console.log('[migrate] loading data.sql (this is the slow one)...');
  const data = stripRestrict(readFileSync(config.dataSqlPath, 'utf8'));
  const ops = parseDataDump(data);

  // The dump references user_ids from WG's prod auth.users that don't exist
  // in our stub. Disable FK + trigger enforcement for the load; we don't
  // need referential integrity validated against an auth schema we're not
  // running. (This is the same trick pg_restore uses.)
  await client.query("SET session_replication_role = 'replica'");
  try {
    let i = 0;
    for (const op of ops) {
      i++;
      try {
        if (op.kind === 'sql') {
          if (op.text.trim()) await client.query(op.text);
        } else {
          process.stdout.write(`[migrate]   COPY ${op.table.split(' ')[0]}... `);
          const stream = client.query(copyFrom(`COPY ${op.table} FROM STDIN`));
          await pipeline(Readable.from([op.rows]), stream);
          process.stdout.write('ok\n');
        }
      } catch (err) {
        console.error(`\n[migrate] FAIL on op ${i}/${ops.length}, kind=${op.kind}`);
        if (op.kind === 'copy') {
          console.error(`           table: ${op.table}`);
          console.error(`           first row: ${op.rows.split('\n')[0].slice(0, 200)}`);
        } else {
          console.error(`           sql preview: ${op.text.slice(0, 300)}`);
        }
        throw err;
      }
    }
  } finally {
    await client.query("SET session_replication_role = 'origin'");
  }

  console.log('[migrate] seeding local user...');
  // auth.users has id as PK so ON CONFLICT works there.
  await client.query(
    `INSERT INTO auth.users (id, email) VALUES ($1, 'local@local.test')
     ON CONFLICT (id) DO NOTHING`,
    [config.localUserId]
  );
  // public_user has no unique constraint on user_id (bigint id is the PK),
  // so we use NOT EXISTS instead. Existing installs may have been
  // seeded with the upstream 'Local User' string before we removed
  // the account UI; force-reset to 'Player' every boot so the value
  // is stable and no UI ever surfaces the legacy text. Cheap (one row).
  await client.query(
    `INSERT INTO public.public_user (user_id, display_name)
     SELECT $1, 'Player'
     WHERE NOT EXISTS (SELECT 1 FROM public.public_user WHERE user_id = $1)`,
    [config.localUserId]
  );
  await client.query(
    `UPDATE public.public_user SET display_name = 'Player' WHERE user_id = $1`,
    [config.localUserId]
  );

  console.log('[migrate] done.');
}

let pgEmbedded, postgrestProc, gatewayServer, gatewayPool, stopping = false;
let pgPostmasterProc = null;
// True only after pgEmbedded.start() has resolved (cluster is fully up).
// Used in stop() so we don't waste 4s waiting for pg_ctl stop on a cluster
// that's still mid-init — if we hard-kill that, postgres leaves behind a
// "starting"-status postmaster.pid that blocks the next launch.
let pgStarted = false;

// Readiness flag flipped by main.cjs once backend.start() resolves. The
// gateway exposes this via /wg/ready so the frontend can defer data-fetch
// queries until pg + postgrest are actually up. Auth/storage stubs work
// without pg so they don't need to wait.
let backendReady = false;
let backendStartError = null;
export function markReady(opts) {
  if (opts && opts.error) {
    backendStartError = opts.error;
    backendReady = false;
  } else {
    backendReady = true;
    backendStartError = null;
  }
}

// Lazy registry of ported functions. Each handler is loaded on first request
// and cached. New ports are picked up on backend restart.
async function mountFunctionDispatcher(app) {
  const { readdirSync } = await import('node:fs');
  const fnDir = path.join(HERE, '..', 'functions');
  let availableNames = [];
  try {
    availableNames = readdirSync(fnDir)
      .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
      .map((f) => f.replace(/\.mjs$/, ''));
  } catch {
    return; // no functions/ dir yet
  }
  if (availableNames.length === 0) return;

  // Configure the shared pg pool used by every ported function.
  const shared = await import('../functions/_shared.mjs');
  shared.configurePool({
    host: 'localhost',
    port: config.pgPort,
    user: 'postgres',
    password: config.pgPassword,
    database: 'postgres',
    max: 8,
  });

  const handlerCache = new Map();
  async function getHandler(name) {
    if (handlerCache.has(name)) return handlerCache.get(name);
    const mod = await import(`../functions/${name}.mjs`);
    const handler = mod.default;
    handlerCache.set(name, handler);
    return handler;
  }

  console.log('[functions] ported in-process:', availableNames.sort().join(', '));

  const jsonParser = express.json({ limit: '10mb' });
  app.use('/functions/v1/:name', (req, res, next) => {
    const name = req.params.name;
    // Not a ported function → fall through to kong (with body bytes intact,
    // since we haven't touched them yet).
    if (!availableNames.includes(name)) return next();
    // Ported. Parse JSON body first, then dispatch.
    jsonParser(req, res, (err) => {
      if (err) {
        res.status(400).json({ status: 'error', message: 'invalid JSON body' });
        return;
      }
      // Compact diagnostic: function name + body keys + body value previews
      // (truncated). Tells us what the frontend is actually asking for.
      const bodyPreview = req.body
        ? Object.fromEntries(
            Object.entries(req.body).map(([k, v]) => {
              if (Array.isArray(v)) return [k, `[${v.length}] ${v.slice(0, 5).join(',')}${v.length > 5 ? '…' : ''}`];
              const s = JSON.stringify(v);
              return [k, s && s.length > 60 ? s.slice(0, 60) + '…' : s];
            })
          )
        : {};
      console.log('[fn]', name, bodyPreview);
      const origJson = res.json.bind(res);
      res.json = (body) => {
        const data = body && body.data;
        const summary = body && body.status === 'success'
          ? Array.isArray(data) ? `success [${data.length}]` : data ? 'success obj' : 'success null'
          : `${body && body.status} ${body && body.message || ''}`;
        console.log('[fn]', name, '->', summary);
        return origJson(body);
      };
      getHandler(name)
        .then((handler) => handler(req, res))
        .catch((e) => {
          console.error('[fn]', name, 'crash:', e && e.stack ? e.stack : e);
          if (!res.headersSent) {
            res.status(200).json({ status: 'error', message: 'function crashed: ' + (e && e.message) });
          }
        });
    });
  });
}

// Decode a JWT payload without verifying the signature. PostgREST verifies
// (with the shared JWT_SECRET) before honouring any auth claim, so this is
// just used to figure out *who* the request is for.
function decodeJwtPayload(token) {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const json = Buffer.from(
      payload.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Cache of user_ids we've already ensured. Avoids hitting the DB on every
// request once a user is known.
const ensuredUsers = new Set();

// Tiny HS256 JWT signer — replaces depending on jsonwebtoken just for this.
// PostgREST validates the same way using PGRST_JWT_SECRET.
function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const data = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

// Phase 3: build the response shape supabase-js expects from GoTrue's
// /token and /user endpoints, but for our single hardcoded local user.
function makeAuthSession() {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = signJwt(
    {
      iss: 'wg-local',
      sub: config.localUserId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'local@local.test',
      exp: now + 3600,
      iat: now,
      aal: 'aal1',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      session_id: '00000000-0000-0000-0000-000000000002',
    },
    config.jwtSecret
  );
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: 'wg-local-refresh',
    user: {
      id: config.localUserId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'local@local.test',
      email_confirmed_at: '2024-01-01T00:00:00.000Z',
      phone: '',
      confirmed_at: '2024-01-01T00:00:00.000Z',
      last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { display_name: 'Player' },
      identities: [],
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: new Date().toISOString(),
      is_anonymous: false,
    },
  };
}

async function ensureUser(userId, email) {
  if (ensuredUsers.has(userId)) return;
  // Insert before adding to cache so a failed insert can be retried.
  await gatewayPool.query(
    `INSERT INTO auth.users (id, email)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [userId, email || 'unknown@local']
  );
  await gatewayPool.query(
    `INSERT INTO public.public_user (user_id, display_name)
     SELECT $1, $2
     WHERE NOT EXISTS (SELECT 1 FROM public.public_user WHERE user_id = $1)`,
    [userId, (email || 'user').split('@')[0]]
  );
  ensuredUsers.add(userId);
}

export async function startGateway() {
  const app = express();

  // Lazy pool for the auth-bridge middleware. We reuse it across requests.
  gatewayPool = new pg.Pool({
    host: 'localhost',
    port: config.pgPort,
    user: 'postgres',
    password: config.pgPassword,
    database: 'postgres',
    max: 4,
  });
  // Pool clients become 'error' when their TCP socket closes abruptly, which
  // is what happens during our hard shutdown sequence (taskkill /F on the
  // postgres processes while idle connections are still attached). Without
  // a listener the error bubbles to the process and Electron pops the
  // 'Uncaught Exception' dialog after the app is already gone. Swallow
  // during shutdown; log otherwise.
  gatewayPool.on('error', (err) => {
    if (stopping) return;
    console.error('[gateway] pool error:', err && err.message ? err.message : err);
  });

  // CORS first so it applies to OPTIONS preflights too. We echo back whatever
  // headers the client asked for in Access-Control-Request-Headers — supabase-js
  // adds new ones across versions (most recently x-supabase-api-version) and
  // hardcoding a list breaks every time it changes. Same effective policy
  // as kong's cors plugin running with default config.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    const requested = req.headers['access-control-request-headers'];
    res.setHeader(
      'Access-Control-Allow-Headers',
      requested || 'Content-Type,Authorization,apikey,Range,Prefer,X-Client-Info,X-Supabase-Api-Version,Range-Unit'
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range,Range,Content-Length');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // Readiness probe for the frontend's "is the backend warm yet" poll. The
  // gateway starts BEFORE pg/postgrest so the frontend bundle can download
  // + parse in parallel with pg warmup. Frontend gates data fetches on this
  // flipping to ready=true. Always serve fast — no pg touch here.
  app.get('/wg/ready', (_req, res) => {
    // No-cache headers are LOAD-BEARING. Without them, Express's default
    // ETag/conditional-GET handling makes the browser see 304 Not Modified
    // on every poll after the first — so it keeps reusing the cached
    // {ready:false} body and the frontend gate never advances.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json({
      ready: backendReady,
      error: backendStartError,
    });
  });

  // Auth bridge: on every authenticated request, copy the requester into
  // the embedded auth.users + public_user (idempotent). Without this,
  // create-character returns "User not found" because the JWT subject has
  // no matching row yet. SKIPPED while backendReady is false — pg might
  // not be up, ensureUser would just error and slow the response.
  app.use(async (req, res, next) => {
    if (!backendReady) return next();
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      const payload = decodeJwtPayload(header.slice(7));
      if (payload && payload.sub) {
        try {
          await ensureUser(payload.sub, payload.email);
        } catch (err) {
          console.error('[gateway] ensureUser failed:', err.message);
        }
      }
    }
    next();
  });

  // Phase 3: /auth/v1/* served entirely in-process. No GoTrue, no signup, no
  // password — just hand the same fixed local user to anyone who asks. The
  // JWT is signed with config.jwtSecret so PostgREST validates it the same
  // way it validated GoTrue-issued tokens.
  app.use('/auth/v1', express.json({ limit: '256kb' }));

  // signInWithPassword + signUp + refresh all collapse to "issue a session".
  app.post('/auth/v1/signup', (_req, res) => res.json(makeAuthSession()));
  app.post('/auth/v1/token', (_req, res) => res.json(makeAuthSession()));

  app.get('/auth/v1/user', (_req, res) => res.json(makeAuthSession().user));
  app.put('/auth/v1/user', (_req, res) => res.json(makeAuthSession().user));

  app.post('/auth/v1/logout', (_req, res) => res.status(204).end());

  // Settings endpoint supabase-js calls on init. Match GoTrue's shape.
  app.get('/auth/v1/settings', (_req, res) =>
    res.json({
      external: { email: true, phone: false },
      disable_signup: false,
      mailer_autoconfirm: true,
      phone_autoconfirm: false,
      sms_provider: '',
    })
  );

  // Catch-all for any /auth/v1 path we haven't explicitly handled, so the
  // frontend gets a tidy JSON response rather than HTML 404.
  app.use('/auth/v1', (req, res) => {
    res.status(200).json({ message: 'wg-local stub: ' + req.method + ' ' + req.url });
  });

  // Phase 4: /storage/v1/* served from disk. supabase-js's storage client
  // talks to a small subset of these endpoints — we only need to cover what
  // the frontend actually calls. Object bytes are written as raw bodies
  // (NOT multipart) per Supabase Storage's API.
  const STORAGE_ROOT = config.storageDir;

  function safeStorageFile(bucket, objectPath) {
    const cleanBucket = String(bucket || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!cleanBucket) throw new Error('invalid bucket');
    // Strip any traversal attempt; path.posix.normalize handles ../ collapses.
    const cleanPath = path.posix
      .normalize('/' + String(objectPath || ''))
      .replace(/^\/+/, '');
    if (cleanPath.split('/').some((seg) => seg === '..')) {
      throw new Error('invalid path');
    }
    return path.join(STORAGE_ROOT, cleanBucket, cleanPath);
  }

  // Raw body parser for uploads — content can be any binary, no specific limit
  // needed beyond a sanity cap.
  const rawBody = express.raw({ type: '*/*', limit: '50mb' });

  // Bucket stubs. We don't track buckets explicitly — they exist whenever a
  // file in them does. Each pretends to be a fully configured public bucket
  // with a 50 MB file size limit (matches our express.raw body cap below).
  function makeBucketInfo(id) {
    const now = new Date().toISOString();
    return {
      id,
      name: id,
      owner: null,
      public: true,
      file_size_limit: 50 * 1024 * 1024,
      allowed_mime_types: null,
      created_at: now,
      updated_at: now,
    };
  }
  app.get('/storage/v1/bucket', (_req, res) => {
    const buckets = existsSync(STORAGE_ROOT) ? readdirSync(STORAGE_ROOT) : [];
    res.json(buckets.map(makeBucketInfo));
  });
  app.post('/storage/v1/bucket', express.json(), (req, res) => {
    const id = req.body && req.body.id;
    if (id) mkdirSync(path.join(STORAGE_ROOT, id), { recursive: true });
    res.json({ name: id });
  });
  app.get('/storage/v1/bucket/:bucket', (req, res) => {
    res.json(makeBucketInfo(req.params.bucket));
  });

  // Helper to extract the object path from express 5 splat params, which
  // can be either a string or an array of segments.
  const splatPath = (req) => {
    const s = req.params.splat;
    return Array.isArray(s) ? s.join('/') : (s || '');
  };

  // Object upload (POST = insert, PUT = upsert; we treat both the same).
  const handleUpload = async (req, res) => {
    try {
      const objectPath = splatPath(req);
      const file = safeStorageFile(req.params.bucket, objectPath);
      mkdirSync(path.dirname(file), { recursive: true });
      await writeFile(file, req.body || Buffer.alloc(0));
      res.json({
        Key: `${req.params.bucket}/${objectPath}`,
        Id: crypto.randomUUID(),
      });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  };
  app.post('/storage/v1/object/:bucket/*splat', rawBody, handleUpload);
  app.put('/storage/v1/object/:bucket/*splat', rawBody, handleUpload);

  // Object download (private + public + authenticated). All resolve to the
  // same on-disk file in our single-user world.
  const handleDownload = (req, res) => {
    try {
      const file = safeStorageFile(req.params.bucket, splatPath(req));
      if (!existsSync(file)) return res.status(404).json({ message: 'not found' });
      createReadStream(file).pipe(res);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  };
  // Order matters: the longer-prefix routes must be registered first or the
  // generic '/object/:bucket/*splat' below greedily captures bucket='public'.
  app.get('/storage/v1/object/public/:bucket/*splat', handleDownload);
  app.get('/storage/v1/object/authenticated/:bucket/*splat', handleDownload);
  app.get('/storage/v1/object/:bucket/*splat', handleDownload);

  // Object delete.
  app.delete('/storage/v1/object/:bucket/*splat', (req, res) => {
    try {
      const file = safeStorageFile(req.params.bucket, splatPath(req));
      if (existsSync(file)) unlinkSync(file);
      res.json({ message: 'Successfully deleted' });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });

  // List objects in a bucket. supabase-js sends a JSON body with prefix etc.;
  // we ignore the body and return everything flat for the bucket.
  app.post('/storage/v1/object/list/:bucket', express.json(), (req, res) => {
    const bucketDir = path.join(STORAGE_ROOT, req.params.bucket);
    if (!existsSync(bucketDir)) return res.json([]);
    const out = [];
    const walk = (dir, prefix) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const rel = prefix ? `${prefix}/${entry}` : entry;
        const st = statSync(full);
        if (st.isDirectory()) walk(full, rel);
        else out.push({ name: rel, id: rel, updated_at: st.mtime.toISOString(), created_at: st.ctime.toISOString(), metadata: { size: st.size } });
      }
    };
    walk(bucketDir, '');
    res.json(out);
  });

  // Signed URL endpoints — single-user PC, no signing needed; just return a
  // URL that hits our public download path.
  app.post('/storage/v1/object/sign/:bucket/*splat', express.json(), (req, res) => {
    const url = `/storage/v1/object/public/${req.params.bucket}/${splatPath(req)}`;
    res.json({ signedURL: url, signedUrl: url });
  });

  // Catch-all for anything else under /storage/v1/.
  app.use('/storage/v1', (req, res) => {
    res.status(200).json({ message: 'wg-local storage stub: ' + req.method + ' ' + req.url });
  });

  // Quick 503 short-circuit for routes that need pg/postgrest to be up.
  // During the parallel-boot window the gateway is listening but pg is
  // still warming — without this guard the proxy fires, gets ECONNREFUSED,
  // and waits the full proxy timeout before responding. The frontend's
  // /wg/ready poll keeps data fetches deferred so this rarely fires, but
  // it's a fast-fail safety net for races.
  const notReadyGuard = (req, res, next) => {
    if (backendReady) return next();
    res.setHeader('Retry-After', '1');
    res.status(503).json({ message: 'Backend warming up; retry shortly.' });
  };
  app.use('/rest/v1', notReadyGuard);
  app.use('/functions/v1', notReadyGuard);

  // /rest/v1/* -> our embedded PostgREST, with the prefix stripped so it
  // matches PostgREST's bare-path routing (PostgREST itself doesn't know
  // about the /rest/v1 mount; that's a Supabase/kong convention).
  app.use(
    '/rest/v1',
    createProxyMiddleware({
      target: `http://localhost:${config.postgrestPort}`,
      changeOrigin: true,
      pathRewrite: { '^/': '/' },
      on: {
        error: (err, req, res) => {
          console.error('[gateway] /rest/v1 upstream error:', err.message);
          if (!res.headersSent) {
            res.statusCode = 502;
            res.end(JSON.stringify({ message: 'Bad Gateway: PostgREST unreachable' }));
          }
        },
      },
    })
  );

  // Phase 5: dispatch /functions/v1/{name} to a ported in-process handler
  // if one exists in electron/functions/. Otherwise fall through to the kong
  // proxy below (still Docker, still using Docker's DB for those — but we
  // port the high-traffic functions first so most requests stay local).
  await mountFunctionDispatcher(app);

  // Unported functions still go to Docker's kong. As we port more, this
  // proxy handles less traffic, eventually nothing.
  app.use(
    createProxyMiddleware({
      target: config.kongUrl,
      changeOrigin: true,
      pathFilter: ['/functions/v1/**'],
      on: {
        error: (err, req, res) => {
          console.error('[gateway] kong upstream error on', req.url, ':', err.message);
          if (!res.headersSent) {
            res.statusCode = 502;
            res.end(JSON.stringify({ message: `Bad Gateway: ${req.url} upstream unreachable. Is Docker running?` }));
          }
        },
      },
    })
  );

  // Static frontend: serve frontend/dist/ as the root of the gateway. Mounted
  // AFTER all the /auth/v1, /rest/v1, /storage/v1, /functions/v1 handlers so
  // they take priority. If frontend/dist doesn't exist (frontend not built
  // yet), we skip mounting and the gateway becomes API-only — Electron will
  // need a different APP_URL.
  const frontendDist = path.join(ROOT, 'frontend', 'dist');
  if (existsSync(path.join(frontendDist, 'index.html'))) {
    console.log('[gateway] serving frontend from', frontendDist);
    app.use(express.static(frontendDist, { fallthrough: true }));
    // SPA fallback: any GET that didn't match a static file and isn't an API
    // path falls back to index.html so React Router URLs work on hard reload.
    app.get(/^\/(?!auth\/v1|rest\/v1|storage\/v1|functions\/v1).*/, (req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  } else {
    console.log('[gateway] frontend/dist not found — gateway is API-only');
  }

  return new Promise((resolve, reject) => {
    // Bind to 127.0.0.1 explicitly (not 0.0.0.0). Without an explicit
    // host, Express listens on all interfaces, which makes Windows
    // Defender Firewall flag the executable as a network-facing
    // service and pop the "Allow this app on private/public
    // networks?" prompt on every launch of an unsigned portable
    // build. Localhost-only binding sidesteps the prompt — the
    // embedded backend is strictly for the renderer in the same
    // process, never served to the network.
    gatewayServer = app.listen(config.gatewayPort, '127.0.0.1', () => {
      console.log('[gateway] listening on 127.0.0.1:' + config.gatewayPort);
      resolve(gatewayServer);
    });
    gatewayServer.on('error', reject);
  });
}

// On Windows, return the image name (e.g. "postgres.exe") of the running
// process with the given PID, or null if no such PID is running. This is
// the only reliable way to distinguish "PID is a live postgres" from "PID
// got recycled to some unrelated process" — process.kill(pid, 0) on
// Windows can return success for a recycled PID and we'd wrongly think
// our previous postgres is still alive.
function getProcessImageNameWindows(pid) {
  try {
    const out = execFileSync(
      'tasklist',
      ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'],
      { encoding: 'utf8', timeout: 3000, windowsHide: true }
    );
    // CSV row format: "image.exe","1234","Console","1","12,345 K"
    const m = out.match(/^"([^"]+)"/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Remove a stale postmaster.pid if the PID inside it isn't a live postgres
// process. Postgres leaves this file behind when it crashes or is
// force-killed (very common when the user closes the app window while pg
// is still warming up); on next start it will refuse to come up,
// thinking another instance is live.
//
// On Windows we DON'T trust process.kill(pid, 0) — Windows recycles PIDs
// aggressively, so a PID written hours ago by a dead postgres may today
// belong to some unrelated process and would falsely look "alive". We
// verify the PID is specifically a postgres.exe via tasklist.
function clearStalePostmasterPid() {
  const pidFile = path.join(config.pgDataDir, 'postmaster.pid');
  if (!existsSync(pidFile)) return;
  try {
    const pid = parseInt(readFileSync(pidFile, 'utf8').split(/\r?\n/, 1)[0], 10);
    if (!Number.isFinite(pid)) {
      unlinkSync(pidFile);
      return;
    }

    if (process.platform === 'win32') {
      // Authoritative on Windows: check that PID is a running postgres.exe.
      const imageName = getProcessImageNameWindows(pid);
      const isLivePostgres = imageName && /^postgres\.exe$/i.test(imageName);
      if (!isLivePostgres) {
        console.log(
          '[pg] stale postmaster.pid (pid', pid,
          imageName ? `is "${imageName}", not postgres.exe` : 'is not running',
          ') — removing'
        );
        unlinkSync(pidFile);
      }
      return;
    }

    // Non-Windows: process.kill(pid, 0) is reliable.
    try {
      process.kill(pid, 0);
      // pid is alive and signalable — leave the file alone.
    } catch (err) {
      const code = err && err.code;
      if (code === 'ESRCH') {
        console.log('[pg] stale postmaster.pid (pid', pid, 'dead) — removing');
        unlinkSync(pidFile);
      }
      // EPERM/other on POSIX: live process owned by another uid; leave it.
    }
  } catch {
    // Unreadable file; safer to just remove it than to fail boot.
    try { unlinkSync(pidFile); } catch {}
  }
}

// First-boot cluster creation. We deliberately do NOT use
// pgEmbedded.initialise(): the embedded-postgres library resolves the
// initdb binary relative to its own module location, which works in dev
// but BREAKS in packaged (asar) builds — initdb is never spawned, the
// cluster is never written, and postgres then dies on startup with
// "could not access the server configuration file ... postgresql.conf".
// Instead we run initdb.exe ourselves from config.pgBinDir — the same
// unpacked bin dir runPostgresDirect uses for postgres.exe — which is
// reliable in both dev and packaged builds.
async function runInitdbDirect(dataDir) {
  // initdb requires an empty (or absent) target. The caller already
  // established there is no valid cluster here (no PG_VERSION), so any
  // leftovers from a previous failed boot (a wg-log dir, a half-written
  // cluster) are safe to wipe before we initialise cleanly.
  try { if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true }); } catch {}
  try { mkdirSync(dataDir, { recursive: true }); } catch {}

  const initdbBin = path.join(config.pgBinDir, 'initdb.exe');
  if (!existsSync(initdbBin)) throw new Error('[pg] initdb.exe not found at ' + initdbBin);

  // Superuser password supplied via file (mirrors authMethod:'password').
  // Written next to the data dir (a writable location) and removed right
  // after initdb consumes it.
  const pwFile = path.join(path.dirname(dataDir), '.wg-initpw');
  writeFileSync(pwFile, String(config.pgPassword ?? ''), 'utf8');

  console.log('[pg] running initdb directly:', initdbBin, '-D', dataDir);
  const proc = spawn(
    initdbBin,
    [
      '-D', dataDir,
      '-U', config.pgUser,
      '-A', 'password',
      `--pwfile=${pwFile}`,
      '--encoding=UTF8',
      '--locale=C',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
  proc.stdout?.on('data', (d) => console.log('[initdb]', String(d).split('\n')[0]));
  proc.stderr?.on('data', (d) => console.error('[initdb]', String(d).split('\n')[0]));

  // CRITICAL: wait for initdb to FULLY exit before deleting the pwfile or
  // starting postgres. The sentinel files (PG_VERSION/postgresql.conf/
  // pg_hba.conf) are written EARLY — before initdb's final password-set +
  // sync steps. Proceeding (or removing the pwfile) on a sentinel poll
  // makes initdb fail at the password step (exit 1) and delete the
  // half-built cluster, so postgres then finds no postgresql.conf. Our
  // direct spawn (unlike the library's) does fire 'exit', so we wait for
  // it; the timeout + sentinel check is only a zombie safety net.
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const ok = ['PG_VERSION', 'postgresql.conf', 'pg_hba.conf'].every((n) => existsSync(path.join(dataDir, n)));
        ok ? resolve() : reject(new Error('initdb timed out without producing a cluster'));
      }, 120_000);
      proc.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('initdb exited with code ' + code)); });
      proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  } finally {
    try { unlinkSync(pwFile); } catch {}
  }

  // Hard-verify the cluster actually exists — fail loudly rather than
  // letting postgres start against an empty dir.
  if (!existsSync(path.join(dataDir, 'PG_VERSION')) || !existsSync(path.join(dataDir, 'postgresql.conf'))) {
    throw new Error('[pg] initdb did not produce a valid cluster at ' + dataDir);
  }
  console.log('[pg] initdb cluster created');
}

export async function start() {
  const isFirstBoot = !existsSync(path.join(config.pgDataDir, 'PG_VERSION'));
  if (!isFirstBoot) clearStalePostmasterPid();

  pgEmbedded = new EmbeddedPostgres({
    databaseDir: config.pgDataDir,
    port: config.pgPort,
    user: config.pgUser,
    password: config.pgPassword,
    authMethod: 'password',
    persistent: true,
    // Force UTF-8 + C locale. Default is OS-derived which on Windows can land
    // on WIN1255/WIN1252/etc. and silently corrupt PF2e content during the
    // data load (em-dashes, accented chars). Run once at initdb time.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // We surface pg's stdout for diagnostics — earlier silenced
    // entirely, but when pgEmbedded.start() hangs we have no visibility
    // into what postgres is doing. Tag the lines as [pg-out] so they
    // don't blend with our own [pg] log lines.
    onLog: (line) => console.log('[pg-out]', String(line).split('\n')[0]),
    onError: (err) => console.error('[pg]', String(err).split('\n')[0]),
  });

  if (isFirstBoot) {
    console.log('[pg] first boot, initialising data dir at', config.pgDataDir);
    const t0 = Date.now();
    // Spawn initdb.exe directly (see runInitdbDirect) rather than
    // pgEmbedded.initialise(), whose binary resolution breaks in packaged
    // builds and leaves the cluster unwritten — the bug behind "could not
    // access ... postgresql.conf" on a fresh download.
    await runInitdbDirect(config.pgDataDir);
    console.log('[pg] initdb took', Date.now() - t0, 'ms');
  }
  console.log('[pg] starting on port', config.pgPort);
  const tStart = Date.now();
  // Spawn postgres.exe directly, bypassing pgEmbedded.start(). The
  // library's start() does NOT work on this Windows build of node —
  // it never actually spawns the postgres binary and silently rejects
  // with `undefined`. We use the same binary path the library would
  // use and wait for the TCP port to open.
  await runPostgresDirect(config.pgDataDir, config.pgPort);
  pgStarted = true;
  console.log('[pg] start took', Date.now() - tStart, 'ms');

  // Wait until pg is actually READY to answer queries. After an
  // unclean shutdown pg comes up in recovery mode — it accepts TCP
  // connections but rejects every query with SQLSTATE 57P03 ("the
  // database system is starting up") until WAL replay + fsync finish.
  // Probe with SELECT 1 and retry on 57P03 until success or timeout.
  // 180s is generous — recovery on a populated data dir can take
  // 60-90s on Windows with antivirus interference.
  await waitForPgReady(180_000);

  // Bootstrap runs every start (idempotent: DO/IF NOT EXISTS, CREATE OR
  // REPLACE, GRANT). Schema + data load run only on first boot.
  //
  // Build the pg client ourselves rather than going through
  // pgEmbedded.getPgClient(): when start() above rejects (which it
  // routinely does on Windows even though pg is actually fine), the
  // library's internal state is missing and getPgClient throws with
  // no useful message.
  const client = new pg.Client({
    host: '127.0.0.1',
    port: config.pgPort,
    user: config.pgUser,
    password: config.pgPassword,
    database: 'postgres',
  });
  await client.connect();
  try {
    console.log('[bootstrap] roles + auth stubs (always)...');
    await client.query(ROLE_BOOTSTRAP_SQL);
    // CRITICAL: do NOT use `isFirstBoot` (PG_VERSION presence) as a proxy
    // for "schema is loaded". initdb writes PG_VERSION BEFORE our schema
    // bootstrap runs — so if a previous launch was killed mid-bootstrap
    // (force-quit, OS reboot, taskmgr End Task, crash), PG_VERSION ends
    // up present without the schema. Next launch then wrongly skips
    // bootstrap and the app boots against an empty database — the user
    // sees "relation does not exist" for every query and the Characters
    // page is permanently broken.
    //
    // Source of truth: check whether public.public_user actually exists
    // in pg_catalog. Cheap (single index lookup), accurate (matches what
    // queries will actually find), and recovers from interrupted boots.
    const probe = await client.query(
      "SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'public_user' AND c.relkind = 'r' LIMIT 1"
    );
    const schemaLoaded = probe.rowCount > 0;
    if (!schemaLoaded) {
      console.log('[migrate] schema not present, running first-boot migrations…');
      await runFirstBootMigrations(client);
    } else {
      console.log('[pg] schema already loaded (public.public_user exists), skipping import');
    }
  } finally {
    await client.end();
  }

  // Wait until authenticator can actually log in before spawning PostgREST.
  // Sometimes Postgres reports "started" but the role/auth path isn't ready
  // yet, and PostgREST dies with code 3 before printing why. Tight loop —
  // 50 ms initial, exponential backoff up to 500 ms, cap at 10 s total.
  const probeStart = Date.now();
  let waitMs = 50;
  for (;;) {
    const probe = new pg.Client({
      host: 'localhost',
      port: config.pgPort,
      user: 'authenticator',
      password: config.pgPassword,
      database: 'postgres',
      connectionTimeoutMillis: 1500,
    });
    try {
      await probe.connect();
      await probe.query('SELECT 1');
      await probe.end();
      break;
    } catch (err) {
      await probe.end().catch(() => {});
      if (Date.now() - probeStart > 10000) {
        throw new Error(`authenticator login not reachable after 10s: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, waitMs));
      waitMs = Math.min(waitMs * 2, 500);
    }
  }
  console.log('[postgrest] authenticator ready after', Date.now() - probeStart, 'ms, spawning on port', config.postgrestPort);
  // PostgREST's Windows binary dynamically links libpq.dll (and its OpenSSL/
  // ICU/etc. dependencies). embedded-postgres ships those alongside its own
  // postgres.exe, so we prepend that bin dir to PATH instead of duplicating
  // the DLLs next to postgrest.exe.
  const pgBinDir = config.pgBinDir;
  // Capture stdout/stderr so a fast crash (exit 3) still shows the reason.
  postgrestProc = spawn(config.postgrestBin, [], {
    env: {
      ...process.env,
      PATH: `${pgBinDir}${path.delimiter}${process.env.PATH || ''}`,
      PGRST_DB_URI: `postgres://authenticator:${config.pgPassword}@localhost:${config.pgPort}/postgres`,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: config.jwtSecret,
      PGRST_SERVER_PORT: String(config.postgrestPort),
      // Bind to loopback only. PostgREST defaults to 0.0.0.0 (all
      // interfaces), which triggers the Windows Defender Firewall
      // "allow this app on private/public networks?" prompt on every
      // launch of unsigned portable builds. We never serve PostgREST
      // off-machine — the gateway in the same Electron process
      // proxies to it via localhost — so loopback-only is correct
      // and sidesteps the prompt.
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_DB_USE_LEGACY_GUCS: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  postgrestProc.stdout.on('data', (chunk) => process.stdout.write(chunk));
  let lastStderr = '';
  postgrestProc.stderr.on('data', (chunk) => {
    const s = chunk.toString();
    lastStderr += s;
    if (lastStderr.length > 4000) lastStderr = lastStderr.slice(-4000);
    process.stderr.write(s);
  });
  postgrestProc.on('exit', (code) => {
    if (!stopping) {
      console.error('[postgrest] exited unexpectedly with code', code);
      if (lastStderr.trim()) {
        console.error('[postgrest] last stderr:\n' + lastStderr.trim());
      }
    }
  });

  return { pg, postgrest: postgrestProc };
}

// Force-kill orphaned child processes (Windows). embedded-postgres' .stop()
// runs pg_ctl stop, which usually shuts the cluster down cleanly — but if the
// Electron host is killed roughly (window force-closed, taskmgr End Task),
// before-quit may not fire, .stop() never runs, and we leave ~10 postgres.exe
// workers orphaned holding the data dir. This is the safety net.
//
// SYNCHRONOUS: we run via execFileSync so we KNOW the kills landed before
// returning. Previous fire-and-forget spawn() variant could race against
// process.exit() and miss the kill entirely.
export function hardKillBackendChildren() {
  if (process.platform !== 'win32') return;
  for (const image of ['postgres.exe', 'postgrest.exe']) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/IM', image], {
        stdio: 'ignore',
        timeout: 4000,
        windowsHide: true,
      });
    } catch {
      // Non-zero exit is normal — taskkill returns 128 if no process matches.
    }
  }
}

// Remove postmaster.pid + postmaster.opts. After hardKillBackendChildren the
// postgres tree is gone, so any lock file in the data dir is by definition
// stale. Removing it here means the next launch never finds a stale lock
// regardless of how this run was killed.
function removePostmasterLockFiles() {
  for (const name of ['postmaster.pid', 'postmaster.opts']) {
    try {
      const p = path.join(config.pgDataDir, name);
      if (existsSync(p)) unlinkSync(p);
    } catch {}
  }
}

export async function stop() {
  if (stopping) return;
  stopping = true;
  if (gatewayServer) {
    await new Promise((r) => gatewayServer.close(r)).catch(() => {});
  }
  if (gatewayPool) await gatewayPool.end().catch(() => {});
  if (postgrestProc && !postgrestProc.killed) {
    try { postgrestProc.kill(); } catch {}
  }
  // Graceful shutdown path: drive `pg_ctl stop -m fast` directly to
  // disconnect clients and orderly-shutdown the postmaster. This is
  // the difference between "next boot is fast" and "next boot does
  // 60-90s of crash recovery + fsync". pgEmbedded.stop() in theory
  // does the same thing but its pg_ctl wrapper can hang the same way
  // start() does on Windows — driving pg_ctl ourselves with a hard
  // timeout keeps shutdown predictable. We only attempt this if pg
  // came up; killing mid-init pgEmbedded.stop() just burns the budget.
  if (pgEmbedded && pgStarted) {
    await Promise.race([
      pgCtlStopFast(),
      new Promise((r) => setTimeout(r, 10_000)),
    ]);
  }
  // Synchronous force-kill of any surviving children. If pg_ctl stop
  // succeeded above, this is a no-op; if it timed out, this catches
  // the stragglers so we don't leave them dangling.
  hardKillBackendChildren();
  // We just killed the entire postgres tree — any lock file is dead weight.
  // Removing it unconditionally means the next launch never finds a stale
  // lock, regardless of whether this shutdown was graceful or violent.
  removePostmasterLockFiles();
}

// Standalone test entry: `node electron/backend/index.mjs`. Guarded against
// the packaged case where argv[1] is undefined (Electron imports this module
// instead of running it directly).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await start();
  await startGateway();
  // Standalone (non-Electron) run: Electron normally calls markReady() once
  // pg is up — without it we have to flip the flag ourselves here.
  markReady();
  console.log('\n[ready] gateway URLs:');
  console.log(`  http://localhost:${config.gatewayPort}/rest/v1/class?select=name&limit=3   (embedded)`);
  console.log(`  http://localhost:${config.gatewayPort}/auth/v1/health   (in-process auth stub)`);
  console.log('\nCtrl+C to stop.');

  const shutdown = async () => {
    console.log('\nshutting down...');
    await stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
