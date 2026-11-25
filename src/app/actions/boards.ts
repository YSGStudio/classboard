"use server";

import { cleanTemplate, type CardField } from "@/lib/card-fields";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fail, friendlyDbError, type ActionResult } from "@/lib/action-result";
import { descendantBoardIds, removeAttachmentFiles } from "@/lib/storage-cleanup";
import { MAX_COLUMNS, canAddColumn, canDeleteColumn, memberColumns, positionBetween } from "@/lib/columns";
import { computeDrop, type DropPlace } from "@/lib/tree";
import type { Access, TreeNode } from "@/lib/types";
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
    card_fields: CardField[];
    peer_review: boolean;
  }>,
): Promise<ActionResult> {
  if (patch.title !== undefined) {
    patch.title = patch.title.trim();
    if (!patch.title || patch.title.length > 100) return fail("보드 이름은 1~100자여야 합니다.");
  }
  if (patch.card_fields !== undefined) {
    const t = cleanTemplate(patch.card_fields);
    if (typeof t === "string") return fail(t);
    patch.card_fields = t;
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

const DROP_ERROR = {
  same: "같은 자리입니다.",
  cycle: "작업장을 자기 자신이나 하위 작업장 안으로 옮길 수 없습니다.",
  personal: "학생 개인 보드는 다른 작업장으로 옮길 수 없습니다. 순서만 바꿀 수 있어요.",
  missing: "작업장을 찾을 수 없습니다.",
} as const;

/** 드래그 앤 드롭: 다른 작업장의 앞/뒤 또는 안으로 옮기고, 새 부모 아래 순서를 1..n으로 다시 매긴다 */
export async function placeBoard(boardId: string, place: DropPlace): Promise<ActionResult> {
  const { supabase, board } = await boardProject(boardId);
  if (!board) return fail("보드를 찾을 수 없습니다.");
  const { data: tree } = await supabase.rpc("get_board_tree", { p_project: board.project_id });
  const drop = computeDrop((tree ?? []) as TreeNode[], boardId, place);
  if (!drop.ok) return drop.reason === "same" ? { ok: true } : fail(DROP_ERROR[drop.reason]);
  if (drop.parentId !== board.parent_id) {
    const { error, count } = await supabase
      .from("boards")
      .update({ parent_id: drop.parentId, position: drop.order.indexOf(boardId) + 1 }, { count: "exact" })
      .eq("id", boardId);
    if (error) return fail(friendlyDbError(error.message));
    if (!count) return fail("권한이 없습니다.");
  }
  for (const [i, id] of drop.order.entries()) {
    const { error } = await supabase.from("boards").update({ position: i + 1 }).eq("id", id);
    if (error) return fail(friendlyDbError(error.message));
  }
  refresh(board.project_id);
  return { ok: true };
}

/**
 * 작업장 복제: 설정(권한·가리기·평가 기준 표시 등), 열 구성, 학생별 권한, 평가 기준을 복사한다.
 * 카드·하위 작업장·학생 개인 보드는 복사하지 않는다. 원본 바로 아래(같은 부모)에 놓인다.
 */
export async function duplicateBoard(boardId: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data: src } = await supabase.from("boards").select("*").eq("id", boardId).maybeSingle();
  if (!src) return fail("보드를 찾을 수 없습니다.");
  if (src.kind === "personal") return fail("학생 개인 보드는 복제할 수 없습니다.");
  let q = supabase.from("boards").select("position").eq("project_id", src.project_id).gt("position", src.position);
  q = src.parent_id ? q.eq("parent_id", src.parent_id) : q.is("parent_id", null);
  const { data: next } = await q.order("position").limit(1);
  const title = `${src.title} (복사)`.slice(0, 100);
  const { data: copy, error } = await supabase
    .from("boards")
    .insert({
      project_id: src.project_id,
      parent_id: src.parent_id,
      title,
      position: positionBetween(src.position, next?.[0]?.position ?? null),
    })
    .select("id")
    .single();
  if (error || !copy) return fail(friendlyDbError(error?.message));
  const id = copy.id as string;
  // 새 하위 보드는 트리거가 부모 권한으로 시작하므로 원본 설정으로 덮어쓴다
  const { error: e1 } = await supabase
    .from("boards")
    .update({
      default_access: src.default_access,
      hide_mode: src.hide_mode,
      show_criteria: src.show_criteria,
      unlocked: src.unlocked,
      card_fields: src.card_fields ?? [],
      peer_review: src.peer_review ?? true,
    })
    .eq("id", id);
  const [{ data: cols }, { data: perms }, { data: crits }] = await Promise.all([
    supabase.from("columns").select("name, stage, position, color, hide_applies, member_id").eq("board_id", boardId),
    supabase.from("board_permissions").select("student_id, access").eq("board_id", boardId),
    supabase.from("board_criteria").select("criterion_id, position").eq("board_id", boardId),
  ]);
  await supabase.from("board_permissions").delete().eq("board_id", id);
  const results = await Promise.all([
    cols?.length ? supabase.from("columns").insert(cols.map((c) => ({ ...c, board_id: id }))) : null,
    perms?.length ? supabase.from("board_permissions").insert(perms.map((p) => ({ ...p, board_id: id }))) : null,
    crits?.length ? supabase.from("board_criteria").insert(crits.map((c) => ({ ...c, board_id: id }))) : null,
  ]);
  const firstError = e1 ?? results.find((r) => r?.error)?.error;
  if (firstError) return fail(`복제는 되었지만 일부 설정을 복사하지 못했습니다: ${friendlyDbError(firstError.message)}`);
  refresh(src.project_id);
  return { ok: true, data: { id } };
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
  if (!canAddColumn(cols?.length ?? 0)) return fail(`열은 최대 ${MAX_COLUMNS}개까지 만들 수 있습니다.`);
  const position = Math.max(0, ...(cols ?? []).map((c) => c.position)) + 1;
  const { error } = await supabase.from("columns").insert({ board_id: boardId, name: n, color, position });
  if (error) return fail(friendlyDbError(error.message));
  refresh(board.project_id);
  return { ok: true };
}

/** 멤버별로 나누기: 교사의 활성 학생마다 "01. 이름" 열을 만든다(이미 있는 열은 건너뜀). */
export async function addMemberColumns(boardId: string): Promise<ActionResult<{ added: number }>> {
  const { supabase, board } = await boardProject(boardId);
  if (!board) return fail("보드를 찾을 수 없습니다.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("로그인이 필요합니다.");
  const [{ data: students }, { data: cols }] = await Promise.all([
    supabase.from("profiles").select("id, display_name, login_id").eq("teacher_id", user.id).eq("role", "student").eq("active", true),
    supabase.from("columns").select("name, position, member_id").eq("board_id", boardId),
  ]);
  const members = (students ?? []).map((s) => ({ id: s.id as string, name: (s.display_name as string) || (s.login_id as string) }));
  if (members.length === 0) return fail("등록된 학생이 없습니다. 먼저 학생 계정을 만들어 주세요.");
  const existing = cols ?? [];
  const add = memberColumns(
    members,
    existing.map((c) => c.name as string),
    existing.length,
    existing.map((c) => c.member_id as string | null),
  );
  if (add.length === 0) {
    return fail(existing.length >= MAX_COLUMNS ? `열은 최대 ${MAX_COLUMNS}개까지 만들 수 있습니다.` : "모든 학생의 열이 이미 있습니다.");
  }
  const start = Math.max(0, ...existing.map((c) => c.position as number)) + 1;
  const { error } = await supabase
    .from("columns")
    .insert(add.map((c, i) => ({ board_id: boardId, name: c.name, color: c.color, member_id: c.member_id, position: start + i })));
  if (error) return fail(friendlyDbError(error.message));
  refresh(board.project_id);
  return { ok: true, data: { added: add.length } };
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
