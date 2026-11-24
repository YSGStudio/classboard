import { describe, expect, it } from "vitest";
import { derivePassword, generateLoginId, generatePin, isValidLoginId, studentEmail } from "@/lib/student-password";
import { LOCK_MS, MAX_FAILURES, isLocked, nextStateAfterFailure, type LockState } from "@/lib/login-lock";

describe("비밀번호 변환", () => {
  it("4자리 숫자 PIN 생성", () => {
    for (let i = 0; i < 200; i++) expect(generatePin()).toMatch(/^\d{4}$/);
  });
  it("HMAC 변환은 결정적이고 Supabase 최소 길이(6자)를 넘는다", () => {
    const a = derivePassword("kim01", "0420", "pepper");
    expect(a).toBe(derivePassword("kim01", "0420", "pepper"));
    expect(a.length).toBeGreaterThanOrEqual(6);
    expect(a).not.toBe(derivePassword("kim01", "0421", "pepper"));
    expect(a).not.toBe(derivePassword("kim02", "0420", "pepper"));
    expect(a).not.toBe(derivePassword("kim01", "0420", "other"));
  });
  it("4자리가 아니면 거부", () => {
    expect(() => derivePassword("kim01", "123", "p")).toThrow();
    expect(() => derivePassword("kim01", "12345", "p")).toThrow();
    expect(() => derivePassword("kim01", "abcd", "p")).toThrow();
  });
  it("아이디 형식과 내부 이메일", () => {
    expect(isValidLoginId(generateLoginId())).toBe(true);
    expect(isValidLoginId("ab")).toBe(false);
    expect(isValidLoginId("Kim01")).toBe(false);
    expect(studentEmail("kim01")).toBe("kim01@students.invalid");
  });
});

describe("실패 잠금", () => {
  const now = new Date("2026-11-24T10:00:00Z");
  it("5회 연속 실패하면 5분 잠금", () => {
    let s: LockState | null = null;
    for (let i = 1; i < MAX_FAILURES; i++) {
      s = nextStateAfterFailure(s, now);
      expect(isLocked(s, now)).toBe(false);
    }
    s = nextStateAfterFailure(s, now);
    expect(isLocked(s, now)).toBe(true);
    expect(isLocked(s, new Date(now.getTime() + LOCK_MS - 1000))).toBe(true);
    expect(isLocked(s, new Date(now.getTime() + LOCK_MS + 1000))).toBe(false);
  });
  it("잠금이 풀린 뒤에는 다시 0부터 센다", () => {
    const expired: LockState = { failed_count: 0, locked_until: new Date(now.getTime() - 1).toISOString() };
    expect(nextStateAfterFailure(expired, now)).toEqual({ failed_count: 1, locked_until: null });
  });
});
