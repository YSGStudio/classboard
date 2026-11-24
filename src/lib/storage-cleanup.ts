import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const BUCKET = "card-attachments";

/** 행을 지우기 전에 첨부 파일을 Storage에서 지운다(행이 사라지면 정책상 지울 수 없음). */
export async function removeAttachmentFiles(
  supabase: SupabaseClient,
  scope: { cardIds?: string[]; boardIds?: string[]; projectId?: string },
) {
  let cardIds = scope.cardIds ?? [];
  if (scope.projectId || scope.boardIds) {
    let boardIds = scope.boardIds ?? [];
    if (scope.projectId) {
      const { data } = await supabase.from("boards").select("id").eq("project_id", scope.projectId);
      boardIds = (data ?? []).map((b) => b.id);
    }
    if (boardIds.length) {
      const { data } = await supabase.from("cards").select("id").in("board_id", boardIds);
      cardIds = [...cardIds, ...(data ?? []).map((c) => c.id)];
    }
  }
  if (!cardIds.length) return;
  const paths: string[] = [];
  for (let i = 0; i < cardIds.length; i += 200) {
    const { data } = await supabase
      .from("attachments")
      .select("storage_path, thumb_path")
      .in("card_id", cardIds.slice(i, i + 200));
    for (const a of data ?? []) {
      if (a.storage_path) paths.push(a.storage_path);
      if (a.thumb_path) paths.push(a.thumb_path);
    }
  }
  for (let i = 0; i < paths.length; i += 500) {
    await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 500));
  }
}

/** 보드와 모든 하위 보드 id */
export async function descendantBoardIds(supabase: SupabaseClient, projectId: string, rootId: string) {
  const { data } = await supabase.from("boards").select("id, parent_id").eq("project_id", projectId);
  const children = new Map<string, string[]>();
  for (const b of data ?? []) {
    if (!b.parent_id) continue;
    children.set(b.parent_id, [...(children.get(b.parent_id) ?? []), b.id]);
  }
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}
