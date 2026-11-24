import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Profile } from "./types";

export const getMe = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, role, display_name, login_id, teacher_id, active")
    .eq("id", user.id)
    .maybeSingle();
  return (data as Profile | null) ?? null;
});

export async function requireUser(): Promise<Profile> {
  const me = await getMe();
  if (!me || !me.active) redirect("/login");
  return me;
}

export async function requireTeacher(): Promise<Profile> {
  const me = await requireUser();
  if (me.role !== "teacher") redirect("/projects");
  return me;
}
