/**
 * 테스트 시드: 교사 A·B, 교사 A의 학생 30명, 프로젝트(교사 A 1개, 교사 B 1개).
 * 계정 값은 .seed-credentials.json(gitignore)에만 쓴다.
 * 교사 시드 계정은 테스트용 이메일/비밀번호 계정이다(실제 교사는 구글 로그인만 사용).
 */
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { issueStudents } from "../src/lib/students-core";

config({ path: ".env.local" });

const SEED_EMAIL_DOMAIN = "seed.classboard.test";
export const CREDENTIALS_FILE = ".seed-credentials.json";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const pepper = process.env.STUDENT_PASSWORD_PEPPER!;

  const teachers: Record<string, { id: string; email: string; password: string; name: string }> = {};
  for (const key of ["a", "b"]) {
    const email = `teacher-${key}@${SEED_EMAIL_DOMAIN}`;
    const password = randomBytes(18).toString("base64url");
    const name = `교사 ${key.toUpperCase()}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: "teacher" },
      user_metadata: { full_name: name },
    });
    if (error) throw new Error(`teacher ${key}: ${error.message}`);
    teachers[key] = { id: data.user.id, email, password, name };
  }

  const inputs = Array.from({ length: 30 }, (_, i) => ({
    login_id: `stu${String(i + 1).padStart(2, "0")}`,
    display_name: `학생${String(i + 1).padStart(2, "0")}`,
  }));
  const res = await issueStudents(admin, teachers.a.id, inputs, pepper);
  if (!res.ok) throw new Error(res.errors.join("\n"));

  const { data: projA, error: pe } = await admin
    .from("projects")
    .insert({ teacher_id: teachers.a.id, title: "시드 프로젝트", goal: "테스트용 프로젝트", flow: "parallel" })
    .select("id")
    .single();
  if (pe) throw pe;
  const { data: projB } = await admin
    .from("projects")
    .insert({ teacher_id: teachers.b.id, title: "교사 B 프로젝트", goal: "다른 교사", flow: "parallel" })
    .select("id")
    .single();

  writeFileSync(
    CREDENTIALS_FILE,
    JSON.stringify(
      {
        teachers,
        students: res.students.map((s) => ({ id: s.id, login_id: s.login_id, display_name: s.display_name, pin: s.pin })),
        projects: { a: projA!.id, b: projB!.id },
      },
      null,
      2,
    ),
  );
  console.log(`seeded: 2 teachers, ${res.students.length} students, 2 projects → ${CREDENTIALS_FILE}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
