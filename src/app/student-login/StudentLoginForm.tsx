"use client";

import { useActionState } from "react";
import { studentLogin } from "@/app/actions/auth";

export function StudentLoginForm() {
  const [state, action, pending] = useActionState(studentLogin, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label htmlFor="login_id" className="label">
          아이디
        </label>
        <input id="login_id" name="login_id" className="input" autoComplete="username" autoCapitalize="none" required />
      </div>
      <div>
        <label htmlFor="pin" className="label">
          비밀번호 (숫자 4자리)
        </label>
        <input
          id="pin"
          name="pin"
          className="input tracking-[0.5em]"
          type="password"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          autoComplete="current-password"
          required
        />
      </div>
      {state?.error && (
        <p role="alert" className="alert-error">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn-primary min-h-12 w-full text-base" disabled={pending}>
        {pending ? "확인 중…" : "로그인"}
      </button>
    </form>
  );
}
