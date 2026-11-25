import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCardCounts } from "@/lib/board-counts";
import type { Project, TreeNode } from "@/lib/types";
import { roots } from "@/lib/tree";
import type { Criterion } from "@/lib/criteria";
import type { StudentLite } from "@/components/board/BoardSettings";
import { WorkspaceSettings } from "./WorkspaceSettings";

/** 프로젝트 작업장 설정하기 (교사 전용) */
export default async function WorkspaceSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ board?: string }>;
}) {
  const [{ id }, { board }] = await Promise.all([params, searchParams]);
  const me = await requireUser();
  if (me.role !== "teacher") redirect(`/projects/${id}`);
  const supabase = await createClient();
  const [{ data: project }, { data: tree }, { data: students }, { data: criteria }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.rpc("get_board_tree", { p_project: id }),
    supabase.from("profiles").select("id, display_name, login_id, active").eq("teacher_id", me.id).order("display_name").order("login_id"),
    supabase.from("criteria").select("id, name, description, levels").eq("teacher_id", me.id).order("name"),
  ]);
  if (!project) notFound();
  const nodes = (tree ?? []) as TreeNode[];
  const counts = await loadCardCounts(
    supabase,
    nodes.map((n) => n.id),
  );

  return (
    <WorkspaceSettings
      project={project as Project}
      initialNodes={nodes}
      counts={counts}
      students={(students ?? []) as StudentLite[]}
      myCriteria={(criteria ?? []) as Criterion[]}
      initialSelected={board && nodes.some((n) => n.id === board) ? board : (roots(nodes)[0]?.id ?? null)}
    />
  );
}
