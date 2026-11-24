"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fail, friendlyDbError, type ActionResult } from "@/lib/action-result";
import { descendantBoardIds, removeAttachmentFiles } from "@/lib/storage-cleanup";
import { canAddColumn, canDeleteColumn } from "@/lib/columns";
import type { Access } from "@/lib/types";
import type { HideMode } from "@/lib/hiding";

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
}

async function boardProject(boardId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("boards").select("id, project_id, parent_id, kind").eq("id", boardId).maybeSingle();
  return { supabase, board: data as { id: string; project_id: string; parent_id: string | null; kind: string } | null };
}

export async function createBoard(input: {
  projectId: string;
  parentId: string | null;
  title: string;
}): Promise<ActionResult<{ id: string }>> {
  const title = input.title.trim();
  if (!title || title.length > 100) return fail("보드 이름은 1~100자여야 합니다.");
  const supabase = await createClient();
  let q = supabase.from("boards").select("position").eq("project_id", input.projectId);
  q = input.parentId ? q.eq("parent_id", input.parentId) : q.is("parent_id", null);
  const { data: siblings } = await q.order("position", { ascending: false }).limit(1);
  const position = (siblings?.[0]?.position ?? 0) + 1;
  const { data, error } = await supabase
    .from("boards")
    .insert({ project_id: input.projectId, parent_id: input.parentId, title, position })
    .select("id")
    .single();
  if (error) return fail(friendlyDbError(error.message));
  refresh(input.projectId);
  return { ok: true, data: { id: data.id } };
}

export async function updateBoardSettings(
  boardId: string,
  patch: Partial<{
    title: string;
    hide_mode: HideMode;
    show_criteria: boolean;
    unlocked: boolean;
    default_access: Access;
    revealed: boolean;
  }>,
): Promise<ActionResult> {
  if (patch.title !== undefined) {
    patch.title = patch.title.trim();
    if (!patch.title || patch.title.length > 100) return fail("보드 이름은 1~100자여야 합니다.");
  }
  const { supabase, board } = await boardProject(boardId);
  if (!board) return fail("보드를 찾을 수 없습니다.");
  const { error, count } = await supabase.from("boards").update(patch, { count: "exact" }).eq("id", boardId);
  if (error) return fail(friendlyDbError(error.message));
  if (!count) return fail("권한이 없습니다.");
  refresh(board.project_id);
  return { ok: true };
}

/** "모두 공개" / "다시 가리기" (R9): hide_mode는 그대로 두고 revealed만 바꾼다 */
export async function setRevealed(boardId: string, revealed: boolean): Promise<ActionResult> {
  return updateBoardSettings(boardId, { revealed });
}

export async function moveBoard(boardId: string, newParentId: string | null): Promise<ActionResult> {
  const { supabase, board } = await boardProject(boardId);
  if (!board) return fail("보드를 찾을 수 없습니다.");
  let q = supabase.from("boards").select("position").eq("project_id", board.project_id);
  q = newParentId ? q.eq("parent_id", newParentId) : q.is("parent_id", null);
  const { data: siblings } = await q.order("position", { ascending: false }).limit(1);
  const { error, count } = await supabase
    .from("boards")
    .update({ parent_id: newParentId, position: (siblings?.[0]?.position ?? 0) + 1 }, { count: "exact" })
    .eq("id", boardId);
  if (error) return fail(friendlyDbError(error.message));
  if (!count) return fail("권한이 없습니다.");
  refresh(board.project_id);
  return { ok: true };
}

/** 같은 부모 안에서 위/아래로 한 칸 */
export async function reorderBoard(boardId: string, direction: "up" | "down"): Promise<ActionResult> {
  const { supabase, board } = await boardProject(boardId);
  if (!board) return fail("보드를 찾을 수 없습니다.");
  let q = supabase.from("boards").select("id, position").eq("project_id", board.project_id);
  q = board.parent_id ? q.eq("parent_id", board.parent_id) : q.is("parent_id", null);
  const { data: sibs } = await q.order("position").order("id");
  const list = sibs ?? [];
  const i = list.findIndex((s) => s.id === boardId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return { ok: true };
  // 위치를 0..n으로 정규화한 뒤 맞바꾼다
  const order = list.map((s) => s.id);
  [order[i], order[j]] = [order[j], order[i]];
  for (const [k, id] of order.entries()) {
    const { error } = await supabase.from("boards").update({ position: k + 1 }).eq("id", id);
    if (error) return fail(friendlyDbError(error.message));
  }
  refresh(board.project_id);
  return { ok: true };
}

export async function deleteBoard(boardId: string): Promise<ActionResult<{ parentId: string | null }>> {
  const { supabase, board } = await boardProject(boardId);
  if (!board) return fail("보드를 찾을 수 없습니다.");
  const ids = await descendantBoardIds(supabase, board.project_id, boardId);
  await removeAttachmentFiles(supabase, { boardIds: ids });
  const { error, count } = await supabase.from("boards").delete({ count: "exact" }).eq("id", boardId);
  if (error) return fail(friendlyDbError(error.message));
  if (!count) return fail("권한이 없습니다.");
  refresh(board.project_id);
  return { ok: true, data: { parentId: board.parent_id } };
}

/** 학생별 권한: access='default'면 학생별 설정을 지워 기본 권한을 따른다 */
export async function setStudentPermissions(
  boardId: string,
  studentIds: string[],
  access: Access | "default",
): Promise<ActionResult> {
  if (!studentIds.length) return fail("학생을 선택하세요.");
  const { supabase, board } = await boardProject(boardId);
  if (!board) return fail("보드를 찾을 수 없습니다.");
  if (access === "default") {
    const { error } = await supabase.from("board_permissions").delete().eq("board_id", boardId).in("student_id", studentIds);
    if (error) return fail(friendlyDbError(error.message));
  } else {
    const { error } = await supabase
      .from("board_permissions")
      .upsert(studentIds.map((student_id) => ({ board_id: boardId, student_id, access })));
    if (error) return fail(friendlyDbError(error.message));
  }
  refresh(board.project_id);
  return { ok: true };
}

/** 학생별 개인 하위 보드 (R10). studentIds=null이면 전체 + 이후 등록 학생 자동 */
export async function createPersonalBoards(
  boardId: string,
  studentIds: string[] | null,
): Promise<ActionResult<{ count: number; ms: number }>> {
  const { supabase, board } = await boardProject(boardId);
  if (!board) return fail("보드를 찾을 수 없습니다.");
  const t0 = Date.now();
  const { data, error } = await supabase.rpc("create_personal_boards", {
    p_parent: boardId,
    p_students: studentIds,
  });
  const ms = Date.now() - t0;
  console.info(`[personal-boards] board=${boardId} students=${data ?? 0} ms=${ms}`);
  if (error) return fail(friendlyDbError(error.message));
  refresh(board.project_id);
  return { ok: true, data: { count: data as number, ms } };
}

// ---------------------------------------------------------------- 열 (R4)

export async function addColumn(boardId: string, name: string, color: string): Promise<ActionResult> {
  const n = name.trim();
  if (!n || n.length > 40) return fail("열 이름은 1~40자여야 합니다.");
  const { supabase, board } = await boardProject(boardId);
  if (!board) return fail("보드를 찾을 수 없습니다.");
  const { data: cols } = await supabase.from("columns").select("position").eq("board_id", boardId);
  if (!canAddColumn(cols?.length ?? 0)) return fail("열은 최대 8개까지 만들 수 있습니다.");
  const position = Math.max(0, ...(cols ?? []).map((c) => c.position)) + 1;
  const { error } = await supabase.from("columns").insert({ board_id: boardId, name: n, color, position });
  if (error) return fail(friendlyDbError(error.message));
  refresh(board.project_id);
  return { ok: true };
}

export async function updateColumn(
  columnId: string,
  patch: Partial<{ name: string; color: string; hide_applies: boolean }>,
): Promise<ActionResult> {
  if (patch.name !== undefined) {
    patch.name = patch.name.trim();
    if (!patch.name || patch.name.length > 40) return fail("열 이름은 1~40자여야 합니다.");
  }
  if (patch.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(patch.color)) return fail("색 형식이 올바르지 않습니다.");
  const supabase = await createClient();
  const { error, count } = await supabase.from("columns").update(patch, { count: "exact" }).eq("id", columnId);
  if (error) return fail(friendlyDbError(error.message));
  if (!count) return fail("권한이 없습니다.");
  return { ok: true };
}

export async function deleteColumn(columnId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: col } = await supabase.from("columns").select("board_id").eq("id", columnId).maybeSingle();
  if (!col) return fail("열을 찾을 수 없습니다.");
  const { count: n } = await supabase.from("columns").select("id", { count: "exact", head: true }).eq("board_id", col.board_id);
  if (!canDeleteColumn(n ?? 0)) return fail("열은 최소 1개가 있어야 합니다.");
  const { data: cards } = await supabase.from("cards").select("id").eq("column_id", columnId);
  await removeAttachmentFiles(supabase, { cardIds: (cards ?? []).map((c) => c.id) });
  const { error, count } = await supabase.from("columns").delete({ count: "exact" }).eq("id", columnId);
  if (error) return fail(friendlyDbError(error.message));
  if (!count) return fail("권한이 없습니다.");
  return { ok: true };
}

export async function reorderColumn(columnId: string, direction: "left" | "right"): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: col } = await supabase.from("columns").select("board_id").eq("id", columnId).maybeSingle();
  if (!col) return fail("열을 찾을 수 없습니다.");
  const { data: cols } = await supabase.from("columns").select("id").eq("board_id", col.board_id).order("position").order("id");
  const order = (cols ?? []).map((c) => c.id);
  const i = order.indexOf(columnId);
  const j = direction === "left" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= order.length) return { ok: true };
  [order[i], order[j]] = [order[j], order[i]];
  for (const [k, id] of order.entries()) {
    const { error } = await supabase.from("columns").update({ position: k + 1 }).eq("id", id);
    if (error) return fail(friendlyDbError(error.message));
  }
  return { ok: true };
}
