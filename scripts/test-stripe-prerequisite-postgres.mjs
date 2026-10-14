import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Synthetic fixtures only. No env files, inherited credentials, network
// listener, production backup, or remote database connection is used.
const bin = process.env.PG_BIN || "/opt/homebrew/opt/postgresql@17/bin";
const root = path.resolve(import.meta.dirname, "..");
const migration = await fs.readFile(
  path.join(root, "supabase/migrations/20261014022343_stripe_billing_prerequisite.sql"),
  "utf8",
);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-stripe-pg-"));
const socket = await fs.mkdtemp("/tmp/unimate-stripe-socket-");
await fs.chmod(temporary, 0o700);
await fs.chmod(socket, 0o700);
const data = path.join(temporary, "data");
let startAttempted = false;

function command(name, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(bin, name), args, {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        LANG: "C",
        LC_ALL: "C",
        TZ: "UTC",
        TMPDIR: temporary,
        PGPASSFILE: path.join(temporary, "absent-passfile"),
        PGSERVICEFILE: path.join(temporary, "absent-servicefile"),
        PGOPTIONS: "-c statement_timeout=8000 -c lock_timeout=6000",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else
        reject(Object.assign(new Error(`${name} exited ${code}: ${stderr}`), { exitCode: code }));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
const sql = (statement) =>
  command(
    "psql",
    [
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      socket,
      "-p",
      "55441",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    statement,
  );
const pro = "10000000-0000-4000-8000-000000000001";
const free = "10000000-0000-4000-8000-000000000002";
const nullable = "10000000-0000-4000-8000-000000000003";
const asClient = (role, statement) =>
  sql(`set role ${role}; set request.jwt.claim.sub = '${free}'; ${statement}`);
const profiles = () =>
  sql("select json_agg(t order by id) from (select id,is_pro,created_at from public.profiles) t;");
const coursework = () => sql("select json_agg(t order by id) from public.coursework t;");
const pass = (message) => console.log(`PASS ${message}`);

try {
  let share;
  for (const candidate of [
    process.env.PG_SHARE,
    path.resolve(bin, "../share/postgresql"),
    path.resolve(bin, "../share/postgresql@17"),
  ].filter(Boolean)) {
    if (
      await fs.access(path.join(candidate, "postgres.bki")).then(
        () => true,
        () => false,
      )
    ) {
      share = candidate;
      break;
    }
  }
  await command("initdb", [
    "-D",
    data,
    "-U",
    "postgres",
    "-A",
    "trust",
    "--no-locale",
    "--encoding=UTF8",
    ...(share ? ["-L", share] : []),
  ]);
  startAttempted = true;
  await command("pg_ctl", [
    "-D",
    data,
    "-l",
    path.join(temporary, "postgres.log"),
    "-w",
    "start",
    "-o",
    `-h '' -k '${socket}' -p 55441`,
  ]);
  assert.equal(await sql("show listen_addresses;"), "");
  await sql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table public.profiles (id uuid primary key, is_pro boolean, created_at timestamp);
    insert into public.profiles values
      ('${pro}', true, '2026-01-01'), ('${free}', false, '2026-02-01'), ('${nullable}', null, null);
    alter table public.profiles enable row level security;
    create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
    grant all on public.profiles to anon, authenticated, service_role;
    -- Exercise inherited PUBLIC and explicit column grants as well.
    grant update on public.profiles to public;
    grant update(is_pro), insert(id,is_pro) on public.profiles to authenticated;
    create table public.coursework (id integer primary key, student_id uuid, body text);
    insert into public.coursework values (1, '${pro}', 'Keep this coursework'), (2, '${free}', 'Keep this draft');
  `);
  const originalProfiles = await profiles();
  const originalCoursework = await coursework();
  const originalPolicy = await sql(
    "select row_to_json(p) from pg_policies p where schemaname='public' and tablename='profiles';",
  );
  await sql(migration);
  await sql(migration);
  assert.equal(await profiles(), originalProfiles);
  assert.equal(await coursework(), originalCoursework);
  assert.equal(
    await sql(
      "select row_to_json(p) from pg_policies p where schemaname='public' and tablename='profiles';",
    ),
    originalPolicy,
  );
  assert.equal(
    await sql("select count(*) from public.profiles where stripe_customer_id is null;"),
    "3",
  );
  assert.equal(await sql("select count(*) from public.profiles where billing_revision=0;"), "3");
  pass(
    "Initial and repeat apply preserve true/false/null entitlement, profile timestamps, SELECT-own policy and coursework",
  );

  assert.equal(await asClient("authenticated", "select count(*) from public.profiles;"), "1");
  assert.equal(
    await asClient("authenticated", `select count(*) from public.profiles where id='${pro}';`),
    "0",
  );
  await assert.rejects(asClient("anon", "select * from public.profiles;"), /permission denied/);
  // Even a future mistakenly permissive row-write policy cannot restore grants.
  await sql(
    "create policy fixture_permissive_write on public.profiles for all to authenticated using (true) with check (true);",
  );
  for (const role of ["anon", "authenticated"]) {
    for (const statement of [
      `update public.profiles set is_pro=true where id='${free}';`,
      `update public.profiles set stripe_customer_id='cus_attacker' where id='${free}';`,
      `update public.profiles set billing_revision=99 where id='${free}';`,
      `insert into public.profiles(id,is_pro) values ('10000000-0000-4000-8000-000000000099',true);`,
      "delete from public.profiles;",
      "truncate public.profiles;",
    ])
      await assert.rejects(asClient(role, statement), /permission denied/);
  }
  await sql("drop policy fixture_permissive_write on public.profiles;");
  assert.equal(await profiles(), originalProfiles);
  pass(
    "Clients cannot self-grant Pro, rebind customers, insert, delete, truncate, or read another profile",
  );

  await sql(
    `set role service_role; update public.profiles set stripe_customer_id='cus_synthetic_one', is_pro=true where id='${free}';`,
  );
  assert.equal(
    await sql(
      `select is_pro::text || ':' || stripe_customer_id from public.profiles where id='${free}';`,
    ),
    "true:cus_synthetic_one",
  );
  await assert.rejects(
    sql(
      `set role service_role; update public.profiles set stripe_customer_id='cus_synthetic_one' where id='${pro}';`,
    ),
    /duplicate key/,
  );
  await sql(migration);
  assert.equal(
    await sql(`select stripe_customer_id from public.profiles where id='${free}';`),
    "cus_synthetic_one",
  );
  assert.equal(await sql(`select is_pro from public.profiles where id='${pro}';`), "t");
  assert.equal(await coursework(), originalCoursework);
  assert.equal(await sql("select count(*) from public.profiles;"), "3");
  pass(
    "Service role updates billing; duplicate customer binding fails; repeat apply preserves billing and owner legacy Pro",
  );
  // Independent writers both observed revision 0 before their Stripe fetches.
  // Only one response may commit; the stale one must reread/refetch, not retry
  // its old entitlement against a newer revision.
  const compareAndSwap = (isPro, revision) =>
    sql(`set role service_role;
      with changed as (
        update public.profiles set is_pro=${isPro}, billing_revision=${revision + 1}
        where id='${free}' and stripe_customer_id='cus_synthetic_one' and billing_revision=${revision}
        returning is_pro, billing_revision
      ) select coalesce(json_agg(changed), '[]'::json) from changed;`);
  const writers = (await Promise.all([compareAndSwap(false, 0), compareAndSwap(true, 0)])).map(
    (result) => JSON.parse(result),
  );
  assert.deepEqual(writers.map((rows) => rows.length).sort(), [0, 1]);
  const winner = writers.flat()[0];
  assert.equal(winner.billing_revision, 1);
  assert.deepEqual(JSON.parse(await compareAndSwap(!winner.is_pro, 0)), []);
  const readRevision = () =>
    sql(
      `select row_to_json(t) from (select is_pro,billing_revision from public.profiles where id='${free}') t;`,
    );
  assert.deepEqual(JSON.parse(await readRevision()), winner);
  await sql(migration);
  assert.deepEqual(JSON.parse(await readRevision()), winner);
  assert.equal(
    await sql(
      `select stripe_customer_id is null and is_pro and billing_revision=0 from public.profiles where id='${pro}';`,
    ),
    "t",
  );
  assert.equal(await coursework(), originalCoursework);
  pass(
    "Two-writer revision CAS admits one update; stale zero-row update cannot change entitlement; repeat apply preserves revision",
  );
  console.log(
    "PASS Stripe prerequisite migration on private socket-only PostgreSQL (synthetic fixtures)",
  );
} finally {
  let stopped = !startAttempted;
  if (startAttempted) {
    try {
      await command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      stopped = true;
    } catch {
      try {
        await command("pg_ctl", ["-D", data, "status"]);
      } catch (error) {
        stopped = error.exitCode === 3;
      }
    }
  }
  if (stopped) {
    await fs.rm(temporary, { recursive: true, force: true });
    await fs.rm(socket, { recursive: true, force: true });
  } else {
    console.error(`Could not confirm local server stopped; preserving ${temporary} and ${socket}`);
    process.exitCode = 1;
  }
}
