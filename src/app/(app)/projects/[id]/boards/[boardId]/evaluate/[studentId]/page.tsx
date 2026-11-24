import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { BoardView } from "@/lib/types";
import { EvaluationForm } from "./EvaluationForm";
import { EvaluationTarget } from "./EvaluationTarget";

export default async function EvaluatePage({
  params,
}: {
  params: Promise<{ id: string; boardId: string; studentId: string }>;
}) {
  const { id, boardId, studentId } = await params;
  const me = await requireTeacher();
  const supabase = await createClient();
  const [{ data: viewData }, { data: studentRows }, { data: evaluation }] = await Promise.all([
    supabase.rpc("get_board_view", { p_board: boardId }),
    supabase.from("profiles").select("id, display_name, login_id").eq("teacher_id", me.id).eq("active", true).order("display_name").order("login_id"),
    supabase.from("evaluations").select("levels, feedback, published, updated_at").eq("board_id", boardId).eq("student_id", studentId).maybeSingle(),
  ]);
  const view = viewData as BoardView | null;
  const students = studentRows ?? [];
  const idx = students.findIndex((s) => s.id === studentId);
  if (!view || view.board.kind !== "shared" || idx < 0) notFound();
  const student = students[idx];
  const prev = students[idx - 1];
  const next = students[idx + 1];

  // 평가 대상: 개인 하위 보드가 있으면 그 학생의 하위 보드(와 그 아래) 전체, 없으면 이 보드의 그 학생 카드
  let targets: { title: string; view: BoardView }[] = [];
  const { data: personal } = await supabase
    .from("boards")
    .select("id")
    .eq("parent_id", boardId)
    .eq("kind", "personal")
    .eq("owner_id", studentId)
    .maybeSingle();
  if (personal) {
    const { data: all } = await supabase.from("boards").select("id, parent_id, title, position").eq("project_id", id);
    const ids: string[] = [];
    const stack = [personal.id];
    while (stack.length) {
      const cur = stack.pop()!;
      ids.push(cur);
      stack.push(...(all ?? []).filter((b) => b.parent_id === cur).sort((a, b) => b.position - a.position).map((b) => b.id));
    }
    const views = await Promise.all(ids.map((bid) => supabase.rpc("get_board_view", { p_board: bid })));
    targets = views.map((v) => ({ title: (v.data as BoardView).board.title, view: v.data as BoardView }));
  } else if (view.board.has_personal_children) {
    targets = [];
  } else {
    targets = [{ title: view.board.title, view: { ...view, cards: view.cards.filter((c) => c.author_id === studentId) } }];
  }

  const base = `/projects/${id}/boards/${boardId}`;
  return (
    <main className="mx-auto w-full max-w-screen-2xl px-3 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={`${base}/students`} className="text-sm text-indigo-700 underline">
          ← 학생별 보기
        </Link>
        <h1 className="jua text-[26px] leading-tight">
          평가: {view.board.title} — <span data-testid="eval-student">{student.display_name}</span>
        </h1>
        <span className="text-sm text-slate-500">
          {idx + 1} / {students.length}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(320px,420px)]">
        <section aria-label="평가 대상(읽기 전용)" className="min-w-0" data-testid="eval-target" data-mode={personal ? "personal" : "cards"}>
          {targets.length === 0 && <p className="card-panel text-slate-500">이 학생의 개인 보드가 없습니다.</p>}
          {targets.map((t) => (
            <EvaluationTarget key={t.view.board.id} title={t.title} view={t.view} />
          ))}
        </section>
        <EvaluationForm
          key={studentId}
          boardId={boardId}
          studentId={studentId}
          criteria={view.criteria}
          initial={evaluation ?? null}
          prevHref={prev ? `${base}/evaluate/${prev.id}` : null}
          nextHref={next ? `${base}/evaluate/${next.id}` : null}
        />
      </div>
    </main>
  );
}
