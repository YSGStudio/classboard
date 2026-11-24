"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { issueStudents, parseStudentCsv, reissuePin, setStudentActive, type IssuedStudent } from "@/lib/students-core";
import { fail, type ActionResult } from "@/lib/action-result";

async function teacherOrNull() {
  const me = await getMe();
  return me && me.role === "teacher" && me.active ? me : null;
}

/** 요청한 교사의 학생인지 RLS 세션으로 확인 */
async function ownStudent(studentId: string) {
  const supabase = await createClient();
  const me = await teacherOrNull();
  if (!me) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, login_id, teacher_id")
    .eq("id", studentId)
    .eq("teacher_id", me.id)
    .eq("role", "student")
    .maybeSingle();
  return data as { id: string; login_id: string } | null;
}

export async function issueStudentsAction(input: {
  csv?: string;
  single?: { login_id: string; display_name: string };
}): Promise<ActionResult<IssuedStudent[]> & { errors?: string[] }> {
  const me = await teacherOrNull();
  if (!me) return fail("교사만 학생 계정을 발급할 수 있습니다.");
  const rows = input.csv ? parseStudentCsv(input.csv) : input.single ? [input.single] : [];
  const res = await issueStudents(createAdminClient(), me.id, rows, process.env.STUDENT_PASSWORD_PEPPER ?? "");
  revalidatePath("/students");
  if (!res.ok) return { ok: false, error: res.errors.join("\n"), errors: res.errors };
  return { ok: true, data: res.students };
}

export async function reissuePinAction(studentId: string): Promise<ActionResult<{ login_id: string; pin: string }>> {
  const st = await ownStudent(studentId);
  if (!st) return fail("권한이 없습니다.");
  try {
    const pin = await reissuePin(createAdminClient(), st, process.env.STUDENT_PASSWORD_PEPPER ?? "");
    return { ok: true, data: { login_id: st.login_id, pin } };
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function setStudentActiveAction(studentId: string, active: boolean): Promise<ActionResult> {
  const st = await ownStudent(studentId);
  if (!st) return fail("권한이 없습니다.");
  try {
    await setStudentActive(createAdminClient(), studentId, active);
  } catch (e) {
    return fail((e as Error).message);
  }
  revalidatePath("/students");
  return { ok: true };
}

export async function renameStudentAction(studentId: string, displayName: string): Promise<ActionResult> {
  const name = displayName.trim();
  if (!name || name.length > 40) return fail("이름은 1~40자여야 합니다.");
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", studentId);
  if (error) return fail(error.message);
  revalidatePath("/students");
  return { ok: true };
}
