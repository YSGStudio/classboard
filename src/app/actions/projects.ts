"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import { fail, friendlyDbError, type ActionResult } from "@/lib/action-result";
import { removeAttachmentFiles } from "@/lib/storage-cleanup";

type ProjectInput = {
  title: string;
  goal: string;
  start_date: string | null;
  end_date: string | null;
  flow: "sequential" | "parallel";
};

function clean(input: ProjectInput): ProjectInput | string {
  const title = input.title.trim();
  if (!title || title.length > 100) return "제목은 1~100자여야 합니다.";
  if (input.goal.length > 2000) return "목표는 2000자 이하여야 합니다.";
  const start_date = input.start_date || null;
  const end_date = input.end_date || null;
  if (start_date && end_date && end_date < start_date) return "종료일이 시작일보다 빠릅니다.";
  return { title, goal: input.goal, start_date, end_date, flow: input.flow === "sequential" ? "sequential" : "parallel" };
}

export async function createProject(input: ProjectInput): Promise<ActionResult<{ id: string }>> {
  const me = await getMe();
  if (!me || me.role !== "teacher") return fail("교사만 프로젝트를 만들 수 있습니다.");
  const v = clean(input);
  if (typeof v === "string") return fail(v);
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").insert({ ...v, teacher_id: me.id }).select("id").single();
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath("/projects");
  return { ok: true, data: { id: data.id } };
}

export async function updateProject(id: string, input: ProjectInput): Promise<ActionResult> {
  const v = clean(input);
  if (typeof v === "string") return fail(v);
  const supabase = await createClient();
  const { error, count } = await supabase.from("projects").update(v, { count: "exact" }).eq("id", id);
  if (error) return fail(friendlyDbError(error.message));
  if (!count) return fail("권한이 없습니다.");
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  return { ok: true };
}

export async function setProjectArchived(id: string, archived: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("projects")
    .update({ archived_at: archived ? new Date().toISOString() : null }, { count: "exact" })
    .eq("id", id);
  if (error) return fail(friendlyDbError(error.message));
  if (!count) return fail("권한이 없습니다.");
  revalidatePath("/projects");
  return { ok: true };
}

export async function deleteProject(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const me = await getMe();
  if (!me || me.role !== "teacher") return fail("권한이 없습니다.");
  await removeAttachmentFiles(supabase, { projectId: id });
  const { error, count } = await supabase.from("projects").delete({ count: "exact" }).eq("id", id);
  if (error) return fail(friendlyDbError(error.message));
  if (!count) return fail("권한이 없습니다.");
  revalidatePath("/projects");
  redirect("/projects");
}
