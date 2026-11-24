import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

/**
 * service role 클라이언트. RLS를 우회하므로 호출 전에 반드시 요청자 권한을 확인한다.
 * 사용처: 학생 계정 발급·재발급·비활성화(R1), 학생 로그인 실패 잠금(R1), 링크 미리보기 캐시 쓰기(R20).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
