"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { derivePassword, isValidLoginId, normalizeLoginId, PIN_PATTERN, studentEmail } from "@/lib/student-password";
import { isLocked, nextStateAfterFailure, type LockState } from "@/lib/login-lock";

export type LoginState = { error?: string } | undefined;

const GENERIC = "아이디 또는 비밀번호가 올바르지 않습니다.";

/** 학생 로그인: 잠금 확인 → 비밀번호 변환 → signInWithPassword → 실패 기록 */
export async function studentLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const loginId = normalizeLoginId(String(formData.get("login_id") ?? ""));
  const pin = String(formData.get("pin") ?? "").trim();
  if (!isValidLoginId(loginId) || !PIN_PATTERN.test(pin)) return { error: GENERIC };

  const admin = createAdminClient();
  const { data: lockRow } = await admin
    .from("login_attempts")
    .select("failed_count, locked_until")
    .eq("login_id", loginId)
    .maybeSingle();
  const now = new Date();
  if (isLocked(lockRow as LockState | null, now)) {
    return { error: "로그인을 5번 잘못 시도해 5분 동안 잠겼습니다. 잠시 후 다시 시도하거나 선생님께 비밀번호 재발급을 요청하세요." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: studentEmail(loginId),
    password: derivePassword(loginId, pin, process.env.STUDENT_PASSWORD_PEPPER ?? ""),
  });

  let ok = !error && !!data.user;
  if (ok) {
    const { data: prof } = await supabase.from("profiles").select("role, active").eq("id", data.user!.id).maybeSingle();
    if (!prof || prof.role !== "student" || !prof.active) {
      await supabase.auth.signOut();
      ok = false;
    }
  }

  if (!ok) {
    const next = nextStateAfterFailure(lockRow as LockState | null, now);
    await admin.from("login_attempts").upsert({ login_id: loginId, ...next });
    if (next.locked_until) {
      return { error: "로그인을 5번 잘못 시도해 5분 동안 잠겼습니다." };
    }
    return { error: GENERIC };
  }

  await admin.from("login_attempts").delete().eq("login_id", loginId);
  redirect("/projects");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
