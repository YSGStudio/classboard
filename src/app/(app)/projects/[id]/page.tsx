import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Project, TreeNode } from "@/lib/types";
import { ProjectLive } from "./ProjectLive";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project) notFound();
  const { data: tree } = await supabase.rpc("get_board_tree", { p_project: id });
  const nodes = (tree ?? []) as TreeNode[];

  let summary: { boards: number; cards: number; students: number } | null = null;
  if (me.role === "teacher") {
    const boardIds = nodes.map((n) => n.id);
    const [{ count: cards }, { count: students }] = await Promise.all([
      boardIds.length
        ? supabase.from("cards").select("id", { count: "exact", head: true }).in("board_id", boardIds)
        : Promise.resolve({ count: 0 }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("teacher_id", me.id).eq("active", true),
    ]);
    summary = { boards: nodes.length, cards: cards ?? 0, students: students ?? 0 };
  }

  const p = project as Project;
  return (
    <main className="mx-auto w-full max-w-5xl px-3 py-6 sm:px-6">
      <h1 className="text-4xl break-keep">{p.title}</h1>
      {p.goal && <p className="mt-2 whitespace-pre-wrap text-slate-700">{p.goal}</p>}
      <p className="mt-1 text-sm text-muted">
        {p.start_date ?? "?"} ~ {p.end_date ?? "?"} · {p.flow === "sequential" ? "순차형" : "병렬형"}
        {p.archived_at && " · 보관됨"}
      </p>
      {summary && (
        <dl className="mt-5 grid grid-cols-3 gap-3 text-center sm:gap-[22px]">
          <div className="card-panel">
            <dt className="text-sm font-bold text-muted">보드</dt>
            <dd className="jua text-4xl text-primary">{summary.boards}</dd>
          </div>
          <div className="card-panel">
            <dt className="text-sm font-bold text-muted">카드</dt>
            <dd className="jua text-4xl text-primary">{summary.cards}</dd>
          </div>
          <div className="card-panel">
            <dt className="text-sm font-bold text-muted">학생</dt>
            <dd className="jua text-4xl text-primary">{summary.students}</dd>
          </div>
        </dl>
      )}
      <section className="card-panel mt-5">
        <h2 className="mb-3 text-[26px]">보드</h2>
        <ProjectLive projectId={id} initialNodes={nodes} isTeacher={me.role === "teacher"} />
      </section>
    </main>
  );
}
