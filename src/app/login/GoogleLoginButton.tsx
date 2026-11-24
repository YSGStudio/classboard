"use client";

import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

export function GoogleLoginButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn-primary min-h-12 w-full text-base"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await getBrowserClient().auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
      }}
    >
      Google 계정으로 로그인
    </button>
  );
}
