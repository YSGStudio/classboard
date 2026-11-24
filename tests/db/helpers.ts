/**
 * RLS 테스트 공용 도구. 시드(.seed-credentials.json)의 실제 계정으로 로그인해
 * 클라이언트와 같은 경로(anon key + 사용자 세션)로 DB를 호출한다.
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { derivePassword, studentEmail } from "@/lib/student-password";

config({ path: ".env.local", quiet: true });

type Seed = {
  teachers: Record<"a" | "b", { id: string; email: string; password: string; name: string }>;
  students: { id: string; login_id: string; display_name: string; pin: string }[];
  projects: { a: string; b: string };
};

export const seed: Seed = JSON.parse(readFileSync(".seed-credentials.json", "utf8"));

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}

export function signInTeacher(key: "a" | "b") {
  const t = seed.teachers[key];
  return signIn(t.email, t.password);
}

export function signInStudent(index: number) {
  const s = seed.students[index];
  return signIn(studentEmail(s.login_id), derivePassword(s.login_id, s.pin, process.env.STUDENT_PASSWORD_PEPPER!));
}

/** 오류가 나야 하는 호출: 오류 메시지를 돌려준다 */
export function expectError(res: { error: { message: string } | null }): string {
  if (!res.error) throw new Error("expected an error but the call succeeded");
  return res.error.message;
}

export function must<R extends { data: unknown; error: { message: string } | null }>(res: R): NonNullable<R["data"]> {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<R["data"]>;
}

export const TEST_PREFIX = "RLS테스트";
