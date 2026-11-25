import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { TreeNode } from "@/lib/types";
import { loadCardCounts } from "@/lib/board-counts";
import { ProjectSidebar } from "./ProjectSidebar";

/** 프로젝트 = 하나의 방. 왼쪽 작업장 사이드바는 프로젝트 안 모든 화면에서 유지된다. */
export default async function ProjectRoomLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireUser();
  const supabase = await createClient();
  const [{ data: project }, { data: tree }] = await Promise.all([
    supabase.from("projects").select("id, title").eq("id", id).maybeSingle(),
    supabase.rpc("get_board_tree", { p_project: id }),
  ]);
  if (!project) notFound();
  const nodes = (tree ?? []) as TreeNode[];
  const ids = nodes.filter((n) => n.accessible).map((n) => n.id);
  const counts = await loadCardCounts(supabase, ids);

  return (
    <div className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-3 px-3 pt-3 pb-6 sm:px-6 lg:flex-row lg:items-start lg:gap-[22px]">
      <ProjectSidebar
        projectId={id}
        title={project.title as string}
        initialNodes={nodes}
        initialCounts={counts}
        isTeacher={me.role === "teacher"}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
