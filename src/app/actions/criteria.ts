"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import { fail, friendlyDbError, type ActionResult } from "@/lib/action-result";
import { validateLevels, type CriterionLevel } from "@/lib/criteria";

type CriterionInput = { name: string; description: string; levels: CriterionLevel[] };

function clean(input: CriterionInput): CriterionInput | string {
  const name = input.name.trim();
  if (!name || name.length > 60) return "기준 이름은 1~60자여야 합니다.";
  if (input.description.length > 1000) return "설명은 1000자 이하여야 합니다.";
  const levels = input.levels.map((l) => ({
    name: String(l.name ?? "").trim(),
    score: Number(l.score),
    description: String(l.description ?? "").slice(0, 500),
  }));
  const err = validateLevels(levels);
  if (err) return err;
  return { name, description: input.description, levels };
}

export async function createCriterion(input: CriterionInput, attachToBoardId?: string): Promise<ActionResult<{ id: string }>> {
  const me = await getMe();
  if (!me || me.role !== "teacher") return fail("권한이 없습니다.");
  const v = clean(input);
  if (typeof v === "string") return fail(v);
  const supabase = await createClient();
  const { data, error } = await supabase.from("criteria").insert({ ...v, teacher_id: me.id }).select("id").single();
  if (error) return fail(friendlyDbError(error.message));
  if (attachToBoardId) {
    const r = await attachCriterion(attachToBoardId, data.id);
    if (!r.ok) return r;
  }
  revalidatePath("/criteria");
  return { ok: true, data: { id: data.id } };
}

export async function updateCriterion(id: string, input: CriterionInput): Promise<ActionResult> {
  const v = clean(input);
  if (typeof v === "string") return fail(v);
  const supabase = await createClient();
  const { error, count } = await supabase.from("criteria").update(v, { count: "exact" }).eq("id", id);
  if (error) return fail(friendlyDbError(error.message));
  if (!count) return fail("권한이 없습니다.");
  revalidatePath("/criteria");
  return { ok: true };
}

export async function deleteCriterion(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("criteria").delete({ count: "exact" }).eq("id", id);
  if (error) return fail(friendlyDbError(error.message));
  if (!count) return fail("권한이 없습니다.");
  revalidatePath("/criteria");
  return { ok: true };
}

/** 잠긴 기준을 복사해 새 기준 행을 만든다 (R17) */
export async function copyCriterion(id: string): Promise<ActionResult<{ id: string }>> {
  const me = await getMe();
  if (!me || me.role !== "teacher") return fail("권한이 없습니다.");
  const supabase = await createClient();
  const { data: src } = await supabase.from("criteria").select("*").eq("id", id).eq("teacher_id", me.id).maybeSingle();
  if (!src) return fail("기준을 찾을 수 없습니다.");
  const { data, error } = await supabase
    .from("criteria")
    .insert({
      teacher_id: me.id,
      name: `${src.name} (복사본)`.slice(0, 60),
      description: src.description,
      levels: src.levels,
      source_criterion_id: src.id,
    })
    .select("id")
    .single();
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath("/criteria");
  return { ok: true, data: { id: data.id } };
}

export async function attachCriterion(boardId: string, criterionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("board_criteria")
    .select("position")
    .eq("board_id", boardId)
    .order("position", { ascending: false })
    .limit(1);
  const { error } = await supabase
    .from("board_criteria")
    .insert({ board_id: boardId, criterion_id: criterionId, position: (existing?.[0]?.position ?? 0) + 1 });
  if (error) return fail(friendlyDbError(error.message));
  return { ok: true };
}

export async function detachCriterion(boardId: string, criterionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("board_criteria").delete().eq("board_id", boardId).eq("criterion_id", criterionId);
  if (error) return fail(friendlyDbError(error.message));
  return { ok: true };
}

export async function reorderBoardCriterion(boardId: string, criterionId: string, direction: "up" | "down"): Promise<ActionResult> {
  const supabase = await createClient();
  const { data } = await supabase.from("board_criteria").select("criterion_id").eq("board_id", boardId).order("position");
  const order = (data ?? []).map((r) => r.criterion_id);
  const i = order.indexOf(criterionId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= order.length) return { ok: true };
  [order[i], order[j]] = [order[j], order[i]];
  for (const [k, id] of order.entries()) {
    await supabase.from("board_criteria").update({ position: k + 1 }).eq("board_id", boardId).eq("criterion_id", id);
  }
  return { ok: true };
}
