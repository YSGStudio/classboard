/**
 * 원격 Supabase(개발용)에 마이그레이션을 적용하거나 초기화한다.
 *   npx tsx scripts/db.ts apply   — 아직 적용 안 된 마이그레이션 적용
 *   npx tsx scripts/db.ts reset   — 앱 객체·시드 계정·첨부 파일을 지우고 다시 적용 (= supabase db reset 대체)
 * 로컬 Supabase CLI를 쓰면 `supabase db reset`이 같은 마이그레이션을 쓴다.
 */
import { config } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const TABLES = [
  "evaluations", "board_criteria", "criteria", "board_events", "activities", "link_previews",
  "attachments", "cards", "columns", "board_permissions", "boards", "projects", "login_attempts", "profiles",
];
export const SEED_EMAIL_DOMAIN = "seed.classboard.test";

async function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set in .env.local");
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function apply(db: pg.Client) {
  await db.query(`create schema if not exists app_meta;
    create table if not exists app_meta.migrations (name text primary key, applied_at timestamptz not null default now());`);
  const done = new Set((await db.query("select name from app_meta.migrations")).rows.map((r) => r.name));
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    process.stdout.write(`apply ${f} ... `);
    try {
      await db.query("begin");
      await db.query(sql);
      await db.query("insert into app_meta.migrations (name) values ($1)", [f]);
      await db.query("commit");
      console.log("ok");
    } catch (e) {
      await db.query("rollback");
      console.log("FAILED");
      throw e;
    }
  }
}

async function removeSeedUsersAndFiles() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  // 첨부 파일 정리
  const { data: buckets } = await admin.storage.listBuckets();
  if (buckets?.some((b) => b.id === "card-attachments")) {
    const walk = async (prefix: string): Promise<string[]> => {
      const { data } = await admin.storage.from("card-attachments").list(prefix, { limit: 1000 });
      const out: string[] = [];
      for (const item of data ?? []) {
        const p = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id) out.push(p);
        else out.push(...(await walk(p)));
      }
      return out;
    };
    const files = await walk("");
    for (let i = 0; i < files.length; i += 500) await admin.storage.from("card-attachments").remove(files.slice(i, i + 500));
    console.log(`removed ${files.length} storage objects`);
  }
  // 시드·학생 계정 삭제(실제 구글 교사 계정은 남긴다)
  let page = 1;
  let removed = 0;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const targets = data.users.filter(
      (u) => u.email?.endsWith("@students.invalid") || u.email?.endsWith(`@${SEED_EMAIL_DOMAIN}`),
    );
    for (const u of targets) {
      await admin.auth.admin.deleteUser(u.id);
      removed++;
    }
    if (data.users.length < 1000) break;
    if (!targets.length) page++;
  }
  console.log(`removed ${removed} seed/student auth users`);
}

async function reset(db: pg.Client) {
  await removeSeedUsersAndFiles();
  await db.query("begin");
  await db.query("drop trigger if exists on_auth_user_created on auth.users");
  await db.query("drop trigger if exists on_auth_user_app_metadata_updated on auth.users");
  for (const p of ["card_attachments_read", "card_attachments_insert", "card_attachments_delete"]) {
    await db.query(`drop policy if exists ${p} on storage.objects`);
  }
  for (const t of TABLES) await db.query(`drop table if exists public.${t} cascade`);
  const fns = await db.query(`select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'`);
  for (const r of fns.rows) await db.query(`drop function if exists ${r.sig} cascade`);
  await db.query("drop schema if exists app_meta cascade");
  await db.query("commit");
  console.log("dropped app objects");
  await apply(db);
  // 이미 있던 구글 교사 계정의 profiles 복구
  const r = await db.query(`insert into public.profiles (id, role, display_name)
    select id, 'teacher', coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1))
    from auth.users where raw_app_meta_data->>'provider' = 'google' on conflict do nothing`);
  console.log(`restored ${r.rowCount} google teacher profiles`);
}

async function main() {
  const cmd = process.argv[2];
  const db = await connect();
  try {
    if (cmd === "apply") await apply(db);
    else if (cmd === "reset") await reset(db);
    else throw new Error("usage: tsx scripts/db.ts apply|reset");
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
