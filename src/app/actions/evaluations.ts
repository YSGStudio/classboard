"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fail, friendlyDbError, type ActionResult } from "@/lib/action-result";

/** 자동 저장. (보드, 학생)당 1행 — upsert */
export async function saveEvaluation(
  boardId: string,
  studentId: string,
  levels: Record<string, number>,
  feedback: string,
): Promise<ActionResult<{ updated_at: string }>> {
  if (feedback.length > 2000) return fail("피드백은 2000자 이하여야 합니다.");
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(levels)) {
    if (Number.isInteger(v) && v >= 0 && v < 5) clean[k] = v;
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("evaluations")
    .upsert({ board_id: boardId, student_id: studentId, levels: clean, feedback }, { onConflict: "board_id,student_id" })
    .select("updated_at")
    .single();
  if (error) return fail(friendlyDbError(error.message));
  return { ok: true, data: { updated_at: data.updated_at } };
}

/** 평가 공개/취소. studentId=null이면 보드 전체(작성된 평가 모두) */
export async function setEvaluationPublished(
  boardId: string,
  studentId: string | null,
  published: boolean,
): Promise<ActionResult<{ count: number }>> {
  const supabase = await createClient();
  let q = supabase.from("evaluations").update({ published }, { count: "exact" }).eq("board_id", boardId);
  if (studentId) q = q.eq("student_id", studentId);
  const { error, count } = await q;
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath(`/projects`, "layout");
  return { ok: true, data: { count: count ?? 0 } };
}
