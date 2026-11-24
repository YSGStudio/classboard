import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { BoardView, Project, TreeNode } from "@/lib/types";
import type { Criterion } from "@/lib/criteria";
import { BoardClient } from "./BoardClient";
import type { PermissionRow, StudentLite } from "@/components/board/BoardSettings";

export default async function BoardPage({ params }: { params: Promise<{ id: string; boardId: string }> }) {
  const { id, boardId } = await params;
  const me = await requireUser();
  const supabase = await createClient();
  const [{ data: project }, { data: tree }, { data: view }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.rpc("get_board_tree", { p_project: id }),
    supabase.rpc("get_board_view", { p_board: boardId }),
  ]);
  if (!project) notFound();
  const isTeacher = me.role === "teacher";

  let students: StudentLite[] = [];
  let permissions: PermissionRow[] = [];
  let myCriteria: Criterion[] = [];
  if (isTeacher && view) {
    const [s, p, c] = await Promise.all([
      supabase.from("profiles").select("id, display_name, login_id, active").eq("teacher_id", me.id).order("display_name").order("login_id"),
      supabase.from("board_permissions").select("student_id, access").eq("board_id", boardId),
      supabase.from("criteria").select("id, name, description, levels").eq("teacher_id", me.id).order("name"),
    ]);
    students = (s.data ?? []) as StudentLite[];
    permissions = (p.data ?? []) as PermissionRow[];
    myCriteria = (c.data ?? []) as Criterion[];
  }

  return (
    <BoardClient
      key={boardId}
      project={project as Project}
      boardId={boardId}
      initialTree={(tree ?? []) as TreeNode[]}
      initialView={(view as BoardView | null) ?? null}
      isTeacher={isTeacher}
      students={students}
      permissions={permissions}
      myCriteria={myCriteria}
    />
  );
}
