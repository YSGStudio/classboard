import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/types";
import { ProjectForm } from "./ProjectForm";
import { ProjectActions } from "./ProjectActions";

export default async function ProjectsPage() {
  const me = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
  const projects = (data ?? []) as Project[];
  const active = projects.filter((p) => !p.archived_at);
  const archived = projects.filter((p) => p.archived_at);
  return (
    <main className="mx-auto w-full max-w-6xl px-3 py-6 sm:px-6">
      <div className="mb-5 flex items-center gap-3">
        <h1 className="text-4xl">프로젝트</h1>
        <span className="count-pill">{active.length}</span>
      </div>
      {me.role === "teacher" && (
        <details className="group mb-6 rounded-2xl border-2 border-dashed border-muted open:border-solid open:border-transparent open:bg-card open:p-4 open:shadow-[0_4px_0_var(--shadow)]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center rounded-2xl text-[15px] font-bold text-muted hover:bg-white/50 group-open:mb-1 group-open:justify-start group-open:text-ink group-open:hover:bg-transparent">
            ＋ 새 프로젝트 만들기
          </summary>
          <div className="mt-3">
            <ProjectForm />
          </div>
        </details>
      )}
      <ul className="grid gap-[22px] sm:grid-cols-2 lg:grid-cols-3" data-testid="project-list">
        {active.map((p) => (
          <li key={p.id} className="card-panel flex flex-col gap-3">
            <Link href={`/projects/${p.id}`} className="jua text-[22px] leading-snug break-keep text-ink hover:underline">
              {p.title}
            </Link>
            {p.goal && <p className="line-clamp-2 text-sm text-muted">{p.goal}</p>}
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <span className={`badge ${p.flow === "sequential" ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
                {p.flow === "sequential" ? "순차형" : "병렬형"}
              </span>
              {p.start_date ?? "?"} ~ {p.end_date ?? "?"}
            </p>
            {me.role === "teacher" && <ProjectActions project={p} />}
          </li>
        ))}
        {active.length === 0 && <li className="py-6 text-center text-sm text-muted sm:col-span-2 lg:col-span-3">프로젝트가 없습니다.</li>}
      </ul>
      {me.role === "teacher" && archived.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-2xl text-muted">보관된 프로젝트</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((p) => (
              <li key={p.id} className="card-panel flex flex-col gap-3 bg-surface opacity-90 shadow-none">
                <Link href={`/projects/${p.id}`} className="jua text-xl text-muted hover:underline">
                  {p.title}
                </Link>
                <ProjectActions project={p} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
