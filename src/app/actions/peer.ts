"use server";

import { createClient } from "@/lib/supabase/server";
import { fail, friendlyDbError, type ActionResult } from "@/lib/action-result";
import type { ReviewSummary, Stars } from "@/lib/peer";

function peerError(message: string | undefined) {
  const m = message?.match(/PEER_[A-Z]+: (.+)/);
  return m ? m[1] : friendlyDbError(message);
}

/** 동료평가 저장 (자기 자신은 DB가 거부). 빈 별점이면 지운다. */
export async function savePeerReview(boardId: string, targetId: string, stars: Stars): Promise<ActionResult<{ stars: Stars }>> {
  const clean: Stars = {};
  for (const [k, v] of Object.entries(stars)) if (Number.isInteger(v) && v >= 1 && v <= 5) clean[k] = v;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_peer_review", { p_board: boardId, p_target: targetId, p_stars: clean });
  if (error) return fail(peerError(error.message));
  return { ok: true, data: { stars: (data ?? {}) as Stars } };
}

/** 내가 그 친구에게 준 별점(다시 열 때 채워 둠) */
export async function getMyPeerReview(boardId: string, targetId: string): Promise<Stars> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return {};
  const { data } = await supabase
    .from("peer_reviews")
    .select("stars")
    .eq("board_id", boardId)
    .eq("reviewer_id", user.id)
    .eq("target_id", targetId)
    .maybeSingle();
  return (data?.stars ?? {}) as Stars;
}

/** 교사 평가 + 동료평가 평균. 학생은 자기 것만(교사 평가는 공개된 것만). */
export async function getReviewSummary(boardId: string, studentId: string): Promise<ReviewSummary | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_review_summary", { p_board: boardId, p_student: studentId });
  return (data as ReviewSummary | null) ?? null;
}
