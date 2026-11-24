import type { SupabaseClient } from "@supabase/supabase-js";
import {
  derivePassword,
  generateLoginId,
  generatePin,
  isValidLoginId,
  normalizeLoginId,
  studentEmail,
} from "./student-password";

export type StudentInput = { login_id?: string; display_name: string };
export type IssuedStudent = { id: string; login_id: string; display_name: string; pin: string };
export type IssueResult =
  | { ok: true; students: IssuedStudent[] }
  | { ok: false; errors: string[] };

/** CSV(아이디,이름) 파싱. 첫 줄이 헤더면 건너뛴다. */
export function parseStudentCsv(text: string): StudentInput[] {
  const rows: StudentInput[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    const cells = line.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
    if (i === 0 && /아이디|login|id/i.test(cells[0] ?? "") && /이름|name/i.test(cells[1] ?? "")) continue;
    rows.push({ login_id: cells[0] ?? "", display_name: cells[1] ?? "" });
  }
  return rows;
}

/**
 * 학생 계정 일괄 발급. 하나라도 문제가 있으면 아무것도 만들지 않는다.
 * 비밀번호(4자리)는 반환값으로만 돌려주고 저장하지 않는다.
 */
export async function issueStudents(
  admin: SupabaseClient,
  teacherId: string,
  inputs: StudentInput[],
  pepper: string,
): Promise<IssueResult> {
  const errors: string[] = [];
  if (inputs.length === 0) return { ok: false, errors: ["발급할 학생이 없습니다."] };
  if (inputs.length > 200) return { ok: false, errors: ["한 번에 200명까지 발급할 수 있습니다."] };

  const explicit = inputs.map((s) => (s.login_id ? normalizeLoginId(s.login_id) : ""));
  const seen = new Set<string>();
  explicit.forEach((id, i) => {
    const name = inputs[i].display_name.trim();
    if (!name) errors.push(`${i + 1}행: 이름이 비어 있습니다.`);
    if (name.length > 40) errors.push(`${i + 1}행: 이름은 40자 이하여야 합니다.`);
    if (!id) return;
    if (!isValidLoginId(id)) errors.push(`${i + 1}행: 아이디 "${id}"는 영문 소문자·숫자·_ 3~20자여야 합니다.`);
    if (seen.has(id)) errors.push(`${i + 1}행: 아이디 "${id}"가 목록 안에서 중복됩니다.`);
    seen.add(id);
  });
  const toCheck = explicit.filter(Boolean);
  if (toCheck.length) {
    const { data, error } = await admin.from("profiles").select("login_id").in("login_id", toCheck);
    if (error) return { ok: false, errors: [error.message] };
    for (const r of data ?? []) errors.push(`아이디 "${r.login_id}"는 이미 사용 중입니다.`);
  }
  if (errors.length) return { ok: false, errors };

  // 비워 둔 아이디 자동 생성
  const ids = [...explicit];
  for (let i = 0; i < ids.length; i++) {
    if (ids[i]) continue;
    for (let tries = 0; tries < 20; tries++) {
      const cand = generateLoginId();
      if (seen.has(cand)) continue;
      const { data } = await admin.from("profiles").select("id").eq("login_id", cand).maybeSingle();
      if (!data) {
        ids[i] = cand;
        seen.add(cand);
        break;
      }
    }
    if (!ids[i]) return { ok: false, errors: ["아이디 자동 생성에 실패했습니다. 다시 시도해 주세요."] };
  }

  const created: IssuedStudent[] = [];
  const failures: string[] = [];
  const CONCURRENCY = 6;
  for (let start = 0; start < ids.length; start += CONCURRENCY) {
    const batch = ids.slice(start, start + CONCURRENCY).map(async (loginId, k) => {
      const idx = start + k;
      const pin = generatePin();
      const display_name = inputs[idx].display_name.trim();
      const { data, error } = await admin.auth.admin.createUser({
        email: studentEmail(loginId),
        password: derivePassword(loginId, pin, pepper),
        email_confirm: true,
        app_metadata: { role: "student", login_id: loginId, teacher_id: teacherId, display_name },
      });
      if (error || !data.user) {
        failures.push(`아이디 "${loginId}": ${error?.message ?? "생성 실패"}`);
        return;
      }
      created[idx] = { id: data.user.id, login_id: loginId, display_name, pin };
    });
    await Promise.all(batch);
  }

  if (failures.length) {
    // 부분 생성분은 되돌린다
    await Promise.all(created.filter(Boolean).map((s) => admin.auth.admin.deleteUser(s.id)));
    return { ok: false, errors: failures };
  }
  return { ok: true, students: created };
}

export async function reissuePin(
  admin: SupabaseClient,
  student: { id: string; login_id: string },
  pepper: string,
): Promise<string> {
  const pin = generatePin();
  const { error } = await admin.auth.admin.updateUserById(student.id, {
    password: derivePassword(student.login_id, pin, pepper),
  });
  if (error) throw new Error(error.message);
  // 재발급하면 잠금도 풀어 준다
  await admin.from("login_attempts").delete().eq("login_id", student.login_id);
  return pin;
}

export async function setStudentActive(admin: SupabaseClient, studentId: string, active: boolean) {
  const { error } = await admin.auth.admin.updateUserById(studentId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (error) throw new Error(error.message);
  const { error: e2 } = await admin.from("profiles").update({ active }).eq("id", studentId);
  if (e2) throw new Error(e2.message);
}
