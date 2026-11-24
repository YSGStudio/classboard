import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { StudentsClient, type StudentRow } from "./StudentsClient";

export default async function StudentsPage() {
  const me = await requireTeacher();
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, login_id, display_name, active, created_at")
    .eq("teacher_id", me.id)
    .order("login_id");
  return (
    <main className="mx-auto w-full max-w-5xl px-3 py-6 sm:px-6">
      <h1 className="mb-4 jua text-[26px] leading-tight">학생 계정</h1>
      <StudentsClient students={(data ?? []) as StudentRow[]} />
    </main>
  );
}
