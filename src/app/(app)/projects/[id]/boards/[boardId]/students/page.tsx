import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PublishAll } from "./PublishAll";

type Summary = {
  columns: { id: string; name: string; color: string }[];
  has_criteria: boolean;
  students: {
    id: string;
    display_name: string;
    login_id: string;
    active: boolean;
    counts: Record<string, number>;
    personal_board_id: string | null;
    personal_count: number | null;
    personal_counts: { name: string; count: number }[] | null;
    evaluation_status: "none" | "draft" | "published";
  }[];
};

const STATUS: Record<Summary["students"][number]["evaluation_status"], string> = {
  none: "미평가",
  draft: "작성 중",
  published: "공개됨",
};

export default async function StudentSummaryPage({ params }: { params: Promise<{ id: string; boardId: string }> }) {
  const { id, boardId } = await params;
  await requireTeacher();
  const supabase = await createClient();
  const [{ data: board }, { data, error }] = await Promise.all([
    supabase.from("boards").select("id, title").eq("id", boardId).maybeSingle(),
    supabase.rpc("get_board_student_summary", { p_board: boardId }),
  ]);
  if (!board || error) notFound();
  const s = data as Summary;
  const hasPersonal = s.students.some((x) => x.personal_board_id);
  return (
    <main className="mx-auto w-full max-w-screen-xl px-3 py-6 sm:px-6">
      <p className="text-sm">
        <Link href={`/projects/${id}/boards/${boardId}`} className="text-indigo-700 underline">
          ← {board.title}
        </Link>
      </p>
      <h1 className="mb-3 jua text-[26px] leading-tight">학생별 보기 — {board.title}</h1>
      {s.has_criteria && <PublishAll boardId={boardId} />}
      <div className="overflow-x-auto rounded-2xl bg-card shadow-[0_4px_0_var(--shadow)]">
        <table className="w-full min-w-[640px] text-sm" data-testid="summary-table">
          <thead className="bg-slate-50">
            <tr className="text-left">
              <th className="p-2">학생</th>
              {s.columns.map((c) => (
                <th key={c.id} className="p-2" style={{ color: c.color }}>
                  {c.name}
                </th>
              ))}
              {hasPersonal && <th className="p-2">개인 보드 카드</th>}
              {s.has_criteria && <th className="p-2">평가</th>}
            </tr>
          </thead>
          <tbody>
            {s.students.map((st) => (
              <tr key={st.id} className="border-t-2 border-surface" data-testid={`summary-${st.login_id}`}>
                <td className="p-2">
                  {st.display_name} <span className="text-xs text-slate-500">{st.login_id}</span>
                  {!st.active && <span className="ml-1 text-xs text-red-700">비활성</span>}
                </td>
                {s.columns.map((c) => (
                  <td key={c.id} className="p-2 tabular-nums" data-testid="count-cell">
                    {st.counts[c.id] ?? 0}
                  </td>
                ))}
                {hasPersonal && (
                  <td className="p-2">
                    {st.personal_board_id ? (
                      <Link href={`/projects/${id}/boards/${st.personal_board_id}`} className="text-indigo-700 underline" data-testid="personal-count">
                        {st.personal_count}개
                      </Link>
                    ) : (
                      "—"
                    )}
                    {st.personal_counts && st.personal_counts.length > 0 && (
                      <span className="ml-2 text-xs text-slate-500">{st.personal_counts.map((p) => `${p.name} ${p.count}`).join(" · ")}</span>
                    )}
                  </td>
                )}
                {s.has_criteria && (
                  <td className="p-2">
                    <Link href={`/projects/${id}/boards/${boardId}/evaluate/${st.id}`} className="underline" data-testid="eval-status">
                      {STATUS[st.evaluation_status]}
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
