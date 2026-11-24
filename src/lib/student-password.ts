import { createHmac, randomInt } from "node:crypto";

export const STUDENT_EMAIL_DOMAIN = "students.invalid";
export const LOGIN_ID_PATTERN = /^[a-z0-9_]{3,20}$/;
export const PIN_PATTERN = /^\d{4}$/;

export function normalizeLoginId(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidLoginId(id: string): boolean {
  return LOGIN_ID_PATTERN.test(id);
}

export function studentEmail(loginId: string): string {
  return `${loginId}@${STUDENT_EMAIL_DOMAIN}`;
}

/** 4자리 숫자 비밀번호(0000~9999) */
export function generatePin(): string {
  return randomInt(0, 10000).toString().padStart(4, "0");
}

/** 자동 생성 아이디: s + 6자리 숫자 */
export function generateLoginId(): string {
  return `s${randomInt(0, 1_000_000).toString().padStart(6, "0")}`;
}

/**
 * Supabase Auth 비밀번호는 최소 6자라 4자리를 그대로 쓸 수 없다.
 * HMAC-SHA256(pepper, login_id + ":" + pin)을 실제 비밀번호로 쓴다.
 */
export function derivePassword(loginId: string, pin: string, pepper: string): string {
  if (!pepper) throw new Error("STUDENT_PASSWORD_PEPPER is not set");
  if (!PIN_PATTERN.test(pin)) throw new Error("PIN must be 4 digits");
  return createHmac("sha256", pepper).update(`${loginId}:${pin}`).digest("hex");
}
