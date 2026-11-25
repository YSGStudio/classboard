"use server";

import { createClient } from "@/lib/supabase/server";
import { fail, friendlyDbError, type ActionResult } from "@/lib/action-result";
import { removeAttachmentFiles } from "@/lib/storage-cleanup";
import type { Activity, ChecklistItem } from "@/lib/types";
import { sanitizeFieldValues, type CardFieldValues } from "@/lib/card-fields";

export type CardInput = {
  title: string;
  body: string;
  /** 보드 카드 형식의 항목별 값 */
  fields?: CardFieldValues;
  labels: string[];
  due_date: string | null;
  checklist: ChecklistItem[];
};

function clean(input: CardInput): CardInput | string {
  const title = input.title.trim();
  if (!title) return "제목을 입력하세요.";
  if (title.length > 100) return "제목은 100자 이하여야 합니다.";
  if (input.body.length > 2000) return "본문은 2000자 이하여야 합니다.";
  const labels = [...new Set(input.labels.map((l) => l.trim()).filter(Boolean))].slice(0, 10).map((l) => l.slice(0, 20));
  const checklist = input.checklist
    .filter((c) => c.text.trim())
    .slice(0, 50)
    .map((c) => ({ text: c.text.trim().slice(0, 200), done: !!c.done }));
  const fields = sanitizeFieldValues(input.fields);
  if (typeof fields === "string") return fields;
  return { title, body: input.body, fields, labels, due_date: input.due_date || null, checklist };
}

export async function createCard(
  boardId: string,
  columnId: string,
  input: CardInput,
  position: number,
): Promise<ActionResult<{ id: string }>> {
  const v = clean(input);
  if (typeof v === "string") return fail(v);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("로그인이 필요합니다.");
  const { data, error } = await supabase
    .from("cards")
    .insert({ ...v, board_id: boardId, column_id: columnId, author_id: user.id, position })
    .select("id")
    .single();
  if (error) return fail(friendlyDbError(error.message));
  return { ok: true, data: { id: data.id } };
}

export async function updateCard(cardId: string, input: CardInput): Promise<ActionResult> {
  const v = clean(input);
  if (typeof v === "string") return fail(v);
  const supabase = await createClient();
  const { error, count } = await supabase.from("cards").update(v, { count: "exact" }).eq("id", cardId);
  if (error) return fail(friendlyDbError(error.message));
  if (!count) return fail("권한이 없습니다. 자기 카드만 수정할 수 있습니다.");
  return { ok: true };
}

export async function moveCard(cardId: string, columnId: string, position: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("cards")
    .update({ column_id: columnId, position }, { count: "exact" })
    .eq("id", cardId);
  if (error) return fail(friendlyDbError(error.message));
  if (!count) return fail("권한이 없습니다. 자기 카드만 옮길 수 있습니다.");
  return { ok: true };
}

export async function deleteCard(cardId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: can } = await supabase.rpc("can_write_card", { card: cardId });
  if (!can) return fail("권한이 없습니다. 자기 카드만 삭제할 수 있습니다.");
  await removeAttachmentFiles(supabase, { cardIds: [cardId] });
  const { error, count } = await supabase.from("cards").delete({ count: "exact" }).eq("id", cardId);
  if (error) return fail(friendlyDbError(error.message));
  if (!count) return fail("권한이 없습니다.");
  return { ok: true };
}

export async function getCardActivities(cardId: string): Promise<Activity[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_card_activities", { p_card: cardId });
  return (data as Activity[] | null) ?? [];
}

export async function deleteAttachment(attachmentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("attachments")
    .select("id, card_id, storage_path, thumb_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!a) return fail("첨부를 찾을 수 없습니다.");
  const { data: can } = await supabase.rpc("can_write_card", { card: a.card_id });
  if (!can) return fail("권한이 없습니다.");
  const paths = [a.storage_path, a.thumb_path].filter(Boolean) as string[];
  if (paths.length) await supabase.storage.from("card-attachments").remove(paths);
  const { error } = await supabase.from("attachments").delete().eq("id", attachmentId);
  if (error) return fail(friendlyDbError(error.message));
  return { ok: true };
}
