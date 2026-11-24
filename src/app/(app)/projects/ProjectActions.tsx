"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteProject, setProjectArchived } from "@/app/actions/projects";
import type { Project } from "@/lib/types";
import { ProjectForm } from "./ProjectForm";

export function ProjectActions({ project }: { project: Project }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="mt-auto flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {!project.archived_at && (
          <button className="btn" onClick={() => setEditing(!editing)}>
            수정
          </button>
        )}
        <button
          className="btn"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setProjectArchived(project.id, !project.archived_at);
              if (!r.ok) setError(r.error);
              router.refresh();
            })
          }
        >
          {project.archived_at ? "보관 해제" : "보관"}
        </button>
        {confirm ? (
          <button
            className="btn-danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteProject(project.id);
                if (r && !r.ok) setError(r.error);
              })
            }
          >
            정말 삭제(되돌릴 수 없음)
          </button>
        ) : (
          <button className="btn-danger" onClick={() => setConfirm(true)}>
            삭제
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {editing && <ProjectForm project={project} onDone={() => setEditing(false)} />}
    </div>
  );
}
