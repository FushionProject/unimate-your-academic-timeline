import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// A disposable, socket-only PostgreSQL cluster. Never reads project env files
// or contacts a remote database. PG_BIN may select another installed version.
const bin = process.env.PG_BIN || "/opt/homebrew/opt/postgresql@17/bin";
const shareCandidates = [
  process.env.PG_SHARE,
  path.resolve(bin, "../share/postgresql"),
  path.resolve(bin, "../share/postgresql@17"),
].filter(Boolean);
let share;
for (const candidate of shareCandidates) {
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
const root = path.resolve(import.meta.dirname, "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-quota-pg-"));
// PostgreSQL UNIX sockets have a short path limit on macOS. /tmp is private to
// this randomly named, mode-0700 directory even when TMPDIR has a long path.
const socket = await fs.mkdtemp("/tmp/unimate-quota-socket-");
const data = path.join(temporary, "data");
const log = path.join(temporary, "postgres.log");
const pro = "10000000-0000-4000-8000-000000000001";
const free = "10000000-0000-4000-8000-000000000002";
let startAttempted = false;

function command(name, args, input = "", environment = {}) {
  return new Promise((resolve, reject) => {
    // Pass no inherited credentials or PostgreSQL service configuration. All
    // executables and connection targets are selected explicitly.
    const env = {
      PATH: `${bin}:/usr/bin:/bin`,
      LANG: "C",
      LC_ALL: "C",
      TZ: "UTC",
      TMPDIR: temporary,
      PGPASSFILE: path.join(temporary, "no-password-file"),
      PGSERVICEFILE: path.join(temporary, "no-service-file"),
    };
    const child = spawn(path.join(bin, name), args, {
      env: { ...env, ...environment },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else {
        const error = new Error(`${name} exited ${code}: ${stderr.trim()}`);
        error.exitCode = code;
        reject(error);
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function sql(statement, application = "quota-test") {
  return command(
    "psql",
    [
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      socket,
      "-p",
      "55439",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    statement,
    {
      PGAPPNAME: application,
      PGOPTIONS: "-c statement_timeout=8000 -c lock_timeout=6000 -c timezone=UTC",
    },
  );
}
async function value(statement, application) {
  const result = await sql(statement, application);
  return JSON.parse(result.split("\n").filter(Boolean).at(-1));
}
const productCall = (user, feature, request = randomUUID()) =>
  `select row_to_json(r) from public.reserve_ai_entitlement_usage('${user}', '${feature}', '${request}') r;`;
const reserveCall = ({
  user = pro,
  request = randomUUID(),
  daily = 100,
  monthly = 2000,
  global = 1000,
} = {}) =>
  `select public.reserve_ai_usage('${user}', '${request}', 'browser_companion', 'pro', 'openai', ${daily}, ${monthly}, ${global}, 12);`;
const completeCall = (request) =>
  `select public.complete_ai_usage('${pro}', '${request}', 'succeeded', 9, null);`;
const usageTables = [
  "ai_request_ledger",
  "ai_provider_state",
  "ai_usage_global_daily",
  "ai_usage_daily",
  "ai_usage_monthly",
  "ai_usage_reservations",
  "ai_usage_daily_buckets",
  "ai_usage_buckets",
];
const reset = () =>
  sql(`truncate ${usageTables.map((table) => `public.${table}`).join(", ")} restart identity;`);
const pass = (label) => console.log(`PASS ${label}`);

async function waitForActivity(application, event) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const waiting = await value(
      `select to_json(exists(select 1 from pg_stat_activity where application_name='${application}' and (wait_event='${event}' or wait_event_type='${event}')));`,
    );
    if (waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected ${application} to wait on ${event}`);
}

try {
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
  // Startup can launch a server and still fail while waiting for readiness.
  // Always attempt shutdown before deleting a cluster once launch was tried.
  startAttempted = true;
  await command("pg_ctl", [
    "-D",
    data,
    "-l",
    log,
    "-w",
    "start",
    "-o",
    `-h '' -k '${socket}' -p 55439 -c timezone=UTC -c deadlock_timeout=100ms`,
  ]);
  assert.equal(
    await sql("show listen_addresses;"),
    "",
    "The test cluster must never listen on TCP",
  );
  await sql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table public.profiles(id uuid primary key references auth.users(id), is_pro boolean not null default false);
    insert into auth.users values ('${pro}'), ('${free}');
    insert into public.profiles values ('${pro}', true), ('${free}', false);
  `);
  const capacityMigration = await fs.readFile(
    path.join(root, "SUPABASE_USAGE_MIGRATION.sql"),
    "utf8",
  );
  const productMigration = await fs.readFile(
    path.join(root, "supabase/ai_usage_entitlements.sql"),
    "utf8",
  );
  await sql(capacityMigration);
  await sql(productMigration);
  const persistedId = randomUUID();
  assert.equal((await value(productCall(free, "syllabus", persistedId))).allowed, true);
  await sql(capacityMigration);
  await sql(productMigration);
  assert.equal(
    (await value(productCall(free, "syllabus", persistedId))).denial_code,
    "DUPLICATE_REQUEST",
  );
  pass("Both migrations apply twice without losing quota history");

  const tables = usageTables.map((table) => `'${table}'`).join(",");
  assert.equal(
    await value(
      `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${tables}) and c.relrowsecurity;`,
    ),
    8,
  );
  assert.equal(
    await value(
      `select count(*) from pg_policies where schemaname='public' and tablename in (${tables});`,
    ),
    0,
  );
  const functions =
    "'reserve_ai_usage','complete_ai_usage','record_ai_provider_signal','get_ai_usage_summary','reserve_ai_entitlement_usage'";
  const grants = await value(
    `select json_agg(json_build_object('name',p.proname,'definer',p.prosecdef,'config',p.proconfig,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${functions});`,
  );
  assert.equal(grants.length, 5);
  for (const grant of grants) {
    assert.deepEqual(
      [grant.definer, grant.anon, grant.authenticated, grant.service],
      [true, false, false, true],
      grant.name,
    );
    assert.ok(
      grant.config?.some((setting) => /^search_path=(?:""|)$/.test(setting)),
      `${grant.name} must pin an empty search_path`,
    );
  }
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(sql(`set role ${role}; ${productCall(pro, "text")}`), /permission denied/);
    await assert.rejects(sql(`set role ${role}; ${reserveCall()}`), /permission denied/);
    for (const table of usageTables) {
      await assert.rejects(
        sql(`set role ${role}; select * from public.${table};`),
        /permission denied/,
      );
    }
  }
  assert.equal((await value(`set role service_role; ${productCall(pro, "text")}`)).allowed, true);
  pass(
    "All usage tables have RLS; client roles cannot read tables or invoke server-only reservations",
  );

  await reset();
  for (const feature of ["text", "screenshot"]) {
    assert.equal((await value(productCall(free, feature))).denial_code, "PRO_REQUIRED");
  }
  for (let count = 1; count <= 3; count++) {
    const result = await value(productCall(free, "syllabus"));
    assert.equal(result.allowed, count <= 2);
    assert.equal(result.used, Math.min(count, 2));
  }
  const duplicateId = randomUUID();
  assert.equal((await value(productCall(pro, "text", duplicateId))).allowed, true);
  assert.equal(
    (await value(productCall(pro, "text", duplicateId))).denial_code,
    "DUPLICATE_REQUEST",
  );
  await assert.rejects(
    sql(productCall(pro, "screenshot", duplicateId)),
    /already used for another quota bucket/,
  );
  pass("Free/Pro policy, two lifetime parses, and duplicate-ID rejection execute correctly");

  await reset();
  const daily = await Promise.all(
    Array.from({ length: 35 }, () => value(productCall(pro, "screenshot"))),
  );
  assert.equal(daily.filter((result) => result.allowed).length, 25);
  assert.ok(
    daily
      .filter((result) => !result.allowed)
      .every((result) => result.denial_code === "QUOTA_EXCEEDED" && result.used === 25),
  );
  assert.equal(await value("select used from public.ai_usage_daily_buckets;"), 25);
  assert.equal(await value("select used from public.ai_usage_buckets;"), 25);
  pass("35 simultaneous screenshot reservations stop at the 25/day cap");

  await reset();
  await sql(
    `insert into public.ai_usage_buckets values ('${pro}', 'screenshot', to_char(now(),'YYYY-MM'), 300, now()); insert into public.ai_usage_daily_buckets values ('${pro}', 'screenshot', current_date, 7, now());`,
  );
  assert.equal((await value(productCall(pro, "screenshot"))).denial_code, "QUOTA_EXCEEDED");
  assert.equal(
    await value("select used from public.ai_usage_daily_buckets;"),
    7,
    "Monthly denial must reverse the attempted daily increment",
  );
  assert.equal(await value("select count(*) from public.ai_usage_reservations;"), 0);
  await reset();
  await sql(
    `insert into public.ai_usage_buckets values ('${pro}', 'text', to_char(now(),'YYYY-MM'), 749, now());`,
  );
  const monthly = await Promise.all(
    Array.from({ length: 20 }, () => value(productCall(pro, "text"))),
  );
  assert.equal(monthly.filter((result) => result.allowed).length, 1);
  assert.equal(await value("select used from public.ai_usage_buckets;"), 750);
  pass("Monthly caps remain atomic; a rejected screenshot restores its daily allowance");

  await reset();
  const request = randomUUID();
  assert.equal((await value(reserveCall({ request, daily: 1 }))).allowed, true);
  assert.equal((await value(reserveCall({ request }))).code, "DUPLICATE_IN_FLIGHT");
  assert.equal((await value(reserveCall({ daily: 1 }))).code, "PRO_FAIR_USE_LIMIT_REACHED");
  await sql(completeCall(request));
  await sql(completeCall(request));
  assert.equal((await value(reserveCall({ request }))).code, "DUPLICATE_REQUEST");
  const summary = await value("select public.get_ai_usage_summary(current_date);");
  assert.equal(summary.totals.request_count, 1);
  assert.equal(
    summary.totals.estimated_output_tokens,
    9,
    "Completion cannot double-charge output accounting",
  );
  await reset();
  assert.equal((await value(reserveCall({ monthly: 1 }))).allowed, true);
  assert.equal((await value(reserveCall({ monthly: 1 }))).allowed, false);
  await reset();
  const global = await Promise.all(
    Array.from({ length: 20 }, () => value(reserveCall({ global: 3 }))),
  );
  assert.equal(global.filter((result) => result.allowed).length, 3);
  assert.equal(await value("select request_count from public.ai_usage_global_daily;"), 3);
  pass(
    "Capacity daily/monthly/global caps, duplicate requests, completion idempotency and summary work",
  );

  await reset();
  await sql(
    "select public.record_ai_provider_signal('openai', false, true, 2, 60); select public.record_ai_provider_signal('openai', false, false, 2, 60);",
  );
  assert.equal((await value(reserveCall())).code, "PROVIDER_UNAVAILABLE");
  await sql("select public.record_ai_provider_signal('openai', true, false, 2, 60);");
  assert.equal((await value(reserveCall())).allowed, true);
  pass("Provider circuit opens after errors and recovers after a successful signal");

  await reset();
  const finishingId = randomUUID();
  await value(reserveCall({ request: finishingId }));
  // Queue reservation first, then completion, behind a held global-row lock.
  // The original completion held daily while waiting on global, creating a
  // reproducible cycle as soon as the reservation acquired global.
  const blocker = sql(
    "begin; select 1 from public.ai_usage_global_daily where usage_date=current_date for update; select pg_sleep(3); commit;",
    "quota-lock-holder",
  );
  await waitForActivity("quota-lock-holder", "PgSleep");
  const reservation = value(reserveCall(), "quota-lock-reservation");
  await waitForActivity("quota-lock-reservation", "Lock");
  const completion = sql(completeCall(finishingId), "quota-lock-completion");
  await waitForActivity("quota-lock-completion", "Lock");
  const race = await Promise.allSettled([blocker, reservation, completion]);
  assert.ok(
    race.every((result) => result.status === "fulfilled"),
    race
      .map((result) => result.reason?.message)
      .filter(Boolean)
      .join("\n"),
  );
  assert.equal(race[1].value.allowed, true);
  assert.equal(await value("select estimated_output_tokens from public.ai_usage_global_daily;"), 9);
  pass("Competing completion and reservation acquire counters without deadlocking");

  await reset();
  await sql(`begin; ${productCall(pro, "screenshot")} ${reserveCall()} rollback;`);
  for (const table of usageTables)
    assert.equal(
      await value(`select count(*) from public.${table};`),
      0,
      `${table} must roll back test reservations`,
    );
  pass("Runtime verification can roll back every usage table change");
  await sql(
    await fs.readFile(path.join(root, "supabase/ai_usage_entitlements_rollback.sql"), "utf8"),
  );
  await sql(await fs.readFile(path.join(root, "SUPABASE_USAGE_ROLLBACK.sql"), "utf8"));
  assert.equal(
    await value(
      `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${tables});`,
    ),
    0,
  );
  assert.equal(await value("select count(*) from public.profiles;"), 2);
  assert.equal(await value("select count(*) from auth.users;"), 2);
  pass("Reverse-order rollback removes only synthetic usage objects and preserves accounts");
  console.log(
    "PASS real PostgreSQL migration, access-control, runtime and concurrency verification (synthetic, socket-only)",
  );
} finally {
  let stopped = !startAttempted;
  if (startAttempted) {
    try {
      await command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      stopped = true;
    } catch (error) {
      // Exit 3 specifically means no server is running; other failures (or a
      // successful status call) cannot justify removing its data/socket.
      try {
        await command("pg_ctl", ["-D", data, "status"]);
      } catch (statusError) {
        stopped = statusError.exitCode === 3;
      }
      if (!stopped) {
        console.error(
          `Could not confirm isolated PostgreSQL stopped; preserve data and socket for recovery: ${temporary}, ${socket}`,
        );
        console.error(error.message);
        process.exitCode = 1;
      }
    }
  }
  if (stopped) {
    await fs.rm(temporary, { recursive: true, force: true });
    await fs.rm(socket, { recursive: true, force: true });
  }
}
