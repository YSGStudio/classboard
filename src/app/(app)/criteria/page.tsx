import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Criterion } from "@/lib/criteria";
import { CriteriaClient } from "./CriteriaClient";

export default async function CriteriaPage() {
  const me = await requireTeacher();
  const supabase = await createClient();
  const { data } = await supabase
    .from("criteria")
    .select("id, name, description, levels, source_criterion_id, created_at")
    .eq("teacher_id", me.id)
    .order("created_at", { ascending: false });
  const criteria = (data ?? []) as Criterion[];
  // 평가에 쓰인 기준(잠김)
  const { data: evals } = await supabase.from("evaluations").select("levels");
  const used = new Set<string>();
  for (const e of evals ?? []) for (const k of Object.keys(e.levels ?? {})) used.add(k);
  return (
    <main className="mx-auto w-full max-w-4xl px-3 py-6 sm:px-6">
      <h1 className="mb-4 jua text-[26px] leading-tight">평가 기준</h1>
      <CriteriaClient criteria={criteria} locked={[...used]} />
    </main>
  );
}
