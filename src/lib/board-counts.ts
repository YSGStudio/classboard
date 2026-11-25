import type { SupabaseClient } from "@supabase/supabase-js";

/** 보드별 카드 수(지금 사용자에게 보이는 카드만). RLS가 가리기 규칙을 적용한다. */
export async function loadCardCounts(supabase: SupabaseClient, boardIds: string[]): Promise<Record<string, number>> {
  if (boardIds.length === 0) return {};
  const { data } = await supabase.from("cards").select("board_id").in("board_id", boardIds);
  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as { board_id: string }[]) counts[r.board_id] = (counts[r.board_id] ?? 0) + 1;
  return counts;
}
