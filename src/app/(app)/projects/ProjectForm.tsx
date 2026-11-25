"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProject, updateProject } from "@/app/actions/projects";
import type { Project } from "@/lib/types";

export function ProjectForm({ project, onDone }: { project?: Project; onDone?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [v, setV] = useState({
    title: project?.title ?? "",
    goal: project?.goal ?? "",
    start_date: project?.start_date ?? "",
    end_date: project?.end_date ?? "",
    flow: project?.flow ?? ("parallel" as "parallel" | "sequential"),
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const input = { ...v, start_date: v.start_date || null, end_date: v.end_date || null };
          const r = project ? await updateProject(project.id, input) : await createProject(input);
          if (!r.ok) return setError(r.error);
          setError("");
          if (!project) setV({ title: "", goal: "", start_date: "", end_date: "", flow: "parallel" });
          onDone?.();
          router.refresh();
        });
      }}
    >
      <div className="sm:col-span-2">
        <label className="label" htmlFor="p-title">
          제목
        </label>
        <input id="p-title" className="input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required maxLength={100} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="p-goal">
          목표
        </label>
        <textarea id="p-goal" className="input" value={v.goal} onChange={(e) => setV({ ...v, goal: e.target.value })} maxLength={2000} />
      </div>
      <div>
        <label className="label" htmlFor="p-start">
          시작일
        </label>
        <input id="p-start" type="date" className="input" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="p-end">
          종료일
        </label>
        <input id="p-end" type="date" className="input" value={v.end_date} onChange={(e) => setV({ ...v, end_date: e.target.value })} />
      </div>
      {error && <p className="text-sm text-red-700 sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <button className="btn-primary" disabled={pending}>
          {project ? "저장" : "만들기"}
        </button>
      </div>
    </form>
  );
}
