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
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-workspace-pg-"));
// PostgreSQL UNIX sockets have a short path limit on macOS. /tmp is private to
// this randomly named, mode-0700 directory even when TMPDIR has a long path.
const socket = await fs.mkdtemp("/tmp/unimate-workspace-socket-");
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
      "55440",
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
const courseA = "20000000-0000-4000-8000-000000000001";
const courseB = "20000000-0000-4000-8000-000000000002";
const chatA = "30000000-0000-4000-8000-000000000001";
const chatB = "30000000-0000-4000-8000-000000000002";
const itemA = "40000000-0000-4000-8000-000000000001";
const itemB = "40000000-0000-4000-8000-000000000002";
const asUser = (user, statement) =>
  `set role authenticated; set request.jwt.claim.sub='${user}'; ${statement}`;
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
  startAttempted = true;
  await command("pg_ctl", [
    "-D",
    data,
    "-l",
    log,
    "-w",
    "start",
    "-o",
    `-h '' -k '${socket}' -p 55440 -c timezone=UTC`,
  ]);
  assert.equal(await sql("show listen_addresses;"), "");
  await sql(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
    insert into auth.users values ('${pro}'),('${free}');
    create table public.courses(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade);
    create table public.companion_conversations(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, unique(id,user_id));
    insert into public.courses values ('${courseA}','${pro}'),('${courseB}','${free}');
    insert into public.companion_conversations values ('${chatA}','${pro}'),('${chatB}','${free}');
    grant select,delete on public.courses,public.companion_conversations to authenticated;
  `);
  await sql(
    await fs.readFile(
      path.join(root, "supabase/migrations/20261112201345_study_workspace.sql"),
      "utf8",
    ),
  );
  const insert = (id, user, extra = "") =>
    `insert into public.study_items(id,user_id,kind,title${extra ? ",course_id,conversation_id" : ""}) values('${id}','${user}','assignment','Assignment'${extra});`;
  await sql(asUser(pro, insert(itemA, pro, `, '${courseA}','${chatA}'`)));
  await sql(asUser(free, insert(itemB, free)));
  assert.equal(await value(asUser(pro, "select count(*) from public.study_items;")), 1);
  assert.equal(await value(asUser(free, "select count(*) from public.study_items;")), 1);
  await assert.rejects(
    sql("set role anon; select * from public.study_items;"),
    /permission denied/,
  );
  await assert.rejects(sql(asUser(pro, insert(randomUUID(), free))), /signed-in student/);
  await assert.rejects(
    sql(asUser(pro, insert(randomUUID(), pro, `, '${courseB}',null`))),
    /foreign key/,
  );
  await assert.rejects(
    sql(asUser(pro, insert(randomUUID(), pro, `, '${courseA}','${chatB}'`))),
    /foreign key/,
  );
  await assert.rejects(
    sql(asUser(pro, insert(randomUUID(), pro, `, '${courseA}','${chatA}'`))),
    /unique constraint/,
  );
  assert.equal(
    await value(
      asUser(
        free,
        `with changed as(update public.study_items set progress='foreign' where id='${itemA}' returning id) select count(*) from changed;`,
      ),
    ),
    0,
  );
  assert.equal(
    await value(
      asUser(
        free,
        `with removed as(delete from public.study_items where id='${itemA}' returning id) select count(*) from removed;`,
      ),
    ),
    0,
  );
  await assert.rejects(
    sql(asUser(pro, `update public.study_items set user_id='${free}' where id='${itemA}';`)),
    /signed-in student|identity/,
  );
  await assert.rejects(
    sql(asUser(pro, `update public.study_items set kind='note' where id='${itemA}';`)),
    /identity/,
  );
  const writes = await Promise.all([
    value(
      asUser(
        pro,
        `with changed as(update public.study_items set progress='one' where id='${itemA}' and version=1 returning version) select count(*) from changed;`,
      ),
    ),
    value(
      asUser(
        pro,
        `with changed as(update public.study_items set progress='two' where id='${itemA}' and version=1 returning version) select count(*) from changed;`,
      ),
    ),
  ]);
  assert.deepEqual(writes.sort(), [0, 1]);
  assert.equal(
    await value(asUser(pro, `select version from public.study_items where id='${itemA}';`)),
    2,
  );
  assert.equal(
    await value(
      asUser(
        pro,
        `with removed as(delete from public.study_items where id='${itemA}' and version=1 returning id) select count(*) from removed;`,
      ),
    ),
    0,
  );
  await sql(
    asUser(
      pro,
      `delete from public.courses where id='${courseA}'; delete from public.companion_conversations where id='${chatA}';`,
    ),
  );
  assert.deepEqual(
    await value(
      asUser(
        pro,
        `select json_build_object('course',course_id,'chat',conversation_id,'version',version) from public.study_items where id='${itemA}';`,
      ),
    ),
    { course: null, chat: null, version: 4 },
  );
  await assert.rejects(
    sql(
      asUser(
        pro,
        `insert into public.study_items(id,user_id,kind,title,source_url) values('${randomUUID()}','${pro}','link','bad','javascript:alert(1)');`,
      ),
    ),
    /check constraint/,
  );
  await sql(
    asUser(
      pro,
      `insert into public.study_items(id,user_id,kind,title) select gen_random_uuid(),'${pro}','note','Synthetic note' from generate_series(1,999);`,
    ),
  );
  await assert.rejects(
    sql(
      asUser(
        pro,
        `insert into public.study_items(id,user_id,kind,title) values('${randomUUID()}','${pro}','note','Too many');`,
      ),
    ),
    /collection limit/,
  );
  // Account deletion may cascade through classes/conversations while saved
  // items still reference them. Trusted administrative cleanup must succeed.
  await sql(`
    insert into public.courses values ('${courseA}','${pro}');
    insert into public.companion_conversations values ('${chatA}','${pro}');
    update public.study_items set course_id='${courseA}', conversation_id='${chatA}' where id='${itemA}';
    delete from auth.users where id='${pro}';
  `);
  assert.equal(await value("select count(*) from public.study_items;"), 1);
  console.log(
    "PASS real PostgreSQL workspace RLS, ownership, standalone records, concurrent revisions, collection bounds, parent deletion and account cleanup (socket-only fixtures)",
  );
} finally {
  let stopped = !startAttempted;
  if (startAttempted) {
    try {
      await command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      stopped = true;
    } catch (error) {
      try {
        await command("pg_ctl", ["-D", data, "status"]);
      } catch (statusError) {
        stopped = statusError.exitCode === 3;
      }
      if (!stopped) {
        console.error(`Preserving isolated cluster for recovery: ${temporary}, ${socket}`);
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
