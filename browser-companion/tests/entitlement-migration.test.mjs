import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const sql = await readFile(
  new URL("../../supabase/ai_usage_entitlements.sql", import.meta.url),
  "utf8",
);
assert.match(sql, /REVIEW-ONLY STEP 2/);
assert.match(sql, /SUPABASE_USAGE_MIGRATION\.sql \(step 1\)/);
assert.doesNotMatch(sql, /function public\.reserve_ai_usage\(/);
assert.match(sql, /Free: exactly 2 lifetime syllabus parses/);
assert.match(sql, /when 'syllabus' then 30/);
assert.match(sql, /when 'text' then 750/);
assert.match(sql, /when 'screenshot' then 300/);
assert.match(sql, /where d\.used < 25/);
assert.match(sql, /'DUPLICATE_REQUEST'::text/);
assert.match(sql, /primary key \(user_id, feature, period_key\)/);
assert.match(sql, /primary key \(user_id, request_id\)/);
assert.match(sql, /on conflict on constraint ai_usage_buckets_pkey do update/);
assert.doesNotMatch(
  sql,
  /on conflict \(user_id, feature, period_key\)/,
  "The period_key output variable must not collide with the conflict target",
);
assert.match(
  sql,
  /update public\.ai_usage_daily_buckets as d set used = greatest\(0, d\.used - 1\)/,
  "Monthly denial must reverse the daily increment using a qualified column, not the used output variable",
);
assert.match(sql, /where b\.used < selected_limit/);
assert.match(sql, /alter table public\.ai_usage_buckets enable row level security/);
assert.match(sql, /alter table public\.ai_usage_reservations enable row level security/);
assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/);
assert.match(sql, /grant execute on function[\s\S]*to service_role/);
assert.doesNotMatch(sql, /grant execute[\s\S]*to authenticated/);
assert.match(sql, /select coalesce\(p\.is_pro, false\)/);
const statements = sql.replace(/--[^\n]*/g, "").trim();
assert.match(statements, /^begin;/i);
assert.match(statements, /commit;$/i);
assert.equal(
  (statements.match(/^commit;/gim) || []).length,
  1,
  "Create the privileged function and restrict its default grants in one atomic install",
);
for (const table of ["ai_usage_buckets", "ai_usage_daily_buckets", "ai_usage_reservations"]) {
  assert.ok(
    sql.includes(`revoke all on table public.${table} from public, anon, authenticated;`),
    `${table} must revoke inherited PUBLIC access as well as client role grants`,
  );
}
console.log("AI entitlement migration safety assertions passed.");
