import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** 구글 OAuth 콜백. 처음 들어온 교사의 profiles 행은 DB 트리거(handle_new_user)가 만든다. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: prof } = await supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle();
      if (prof?.role === "teacher") return NextResponse.redirect(`${origin}/projects`);
      await supabase.auth.signOut();
    }
  }
  return NextResponse.redirect(`${origin}/login?error=1`);
}
