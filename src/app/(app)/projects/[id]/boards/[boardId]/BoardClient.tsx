"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BoardView, Project, TreeNode } from "@/lib/types";
import type { Criterion } from "@/lib/criteria";
import { pathTo } from "@/lib/tree";
import { HIDE_MODE_LABEL } from "@/lib/hiding";
import { getBrowserClient } from "@/lib/supabase/client";
import { useProjectEvents } from "@/hooks/useProjectEvents";
import { Kanban } from "@/components/kanban/Kanban";
import { BoardSettings, type PermissionRow, type StudentLite } from "@/components/board/BoardSettings";
import { CriteriaPanel, MyEvaluationPanel } from "@/components/board/CriteriaPanel";
import { setRevealed } from "@/app/actions/boards";

export function BoardClient({
  project,
  boardId,
  initialTree,
  initialView,
  isTeacher,
  students,
  permissions,
  myCriteria,
}: {
  project: Project;
  boardId: string;
  initialTree: TreeNode[];
  initialView: BoardView | null;
  isTeacher: boolean;
  students: StudentLite[];
  permissions: PermissionRow[];
  myCriteria: Criterion[];
}) {
  const router = useRouter();
  const [tree, setTree] = useState(initialTree);
  const [view, setView] = useState(initialView);
  const [seen, setSeen] = useState({ initialTree, initialView });
  if (seen.initialTree !== initialTree || seen.initialView !== initialView) {
    setSeen({ initialTree, initialView });
    setTree(initialTree);
    setView(initialView);
  }
  const [settings, setSettings] = useState(false);
  const [pending, start] = useTransition();

  const refetchView = useCallback(async () => {
    const { data } = await getBrowserClient().rpc("get_board_view", { p_board: boardId });
    setView((data as BoardView | null) ?? null);
  }, [boardId]);
  const refetchTree = useCallback(async () => {
    const { data } = await getBrowserClient().rpc("get_board_tree", { p_project: project.id });
    if (data) setTree(data as TreeNode[]);
  }, [project.id]);

  useProjectEvents(project.id, (evs) => {
    const structure = evs.some((e) => e.scope === "structure");
    if (structure) refetchTree();
    if (structure || evs.some((e) => e.board_id === boardId)) refetchView();
  });

  const path = pathTo(tree, boardId);
  const b = view?.board;

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col">
      <main className="flex min-w-0 flex-1 flex-col">
        <nav aria-label="경로" className="px-1 text-sm text-muted" data-testid="breadcrumb">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href={`/projects/${project.id}`} className="hover:underline">
                {project.title}
              </Link>
            </li>
            {path.map((n) => (
              <li key={n.id} className="flex items-center gap-1" data-testid="crumb">
                <span aria-hidden>›</span>
                {n.id === boardId ? (
                  <span className="font-bold text-ink">{n.title}</span>
                ) : n.accessible ? (
                  <Link href={`/projects/${project.id}/boards/${n.id}`} className="hover:underline">
                    {n.title}
                  </Link>
                ) : (
                  <span className="text-slate-400">{n.title}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>

        {!view || !b ? (
          <div className="card-panel m-3 p-6 text-center text-muted" data-testid="no-access">
            이 보드를 볼 권한이 없습니다.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 px-1 py-3">
              <h1 className="text-[32px] leading-tight break-keep text-ink sm:text-4xl" data-testid="board-title">
                {b.title}
              </h1>
              {b.kind === "personal" && <span className="badge bg-primary-soft text-primary">개인 보드{b.owner_name ? ` · ${b.owner_name}` : ""}</span>}
              {b.access === "read" && <span className="badge bg-surface text-muted">읽기 전용</span>}
              {b.locked && <span className="badge bg-amber-100 text-amber-800">🔒 {isTeacher ? "학생에게 닫힘" : "잠김"}</span>}
              {isTeacher && b.hide_mode !== "off" && (
                <span className="badge bg-amber-100 text-amber-900">
                  가리기 {HIDE_MODE_LABEL[b.hide_mode]}
                  {b.revealed ? " · 공개 중" : ""}
                </span>
              )}
              {isTeacher && (
                <div className="ml-auto flex flex-wrap gap-2">
                  {b.hide_mode !== "off" && b.kind === "shared" && (
                    <button
                      className={b.revealed ? "btn" : "btn-gold"}
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          await setRevealed(b.id, !b.revealed);
                          await refetchView();
                        })
                      }
                    >
                      {b.revealed ? "다시 가리기" : "모두 공개"}
                    </button>
                  )}
                  {b.kind === "shared" && (
                    <Link className="btn" href={`/projects/${project.id}/boards/${b.id}/students`}>
                      학생별 보기
                    </Link>
                  )}
                  <button className="btn" onClick={() => setSettings(true)}>
                    설정
                  </button>
                </div>
              )}
            </div>
            <MyEvaluationPanel view={view} />
            <CriteriaPanel view={view} />
            {b.locked && !isTeacher ? (
              <div className="m-3 rounded-2xl border-[3px] border-accent bg-done p-6 text-center text-lg font-bold text-amber-900" data-testid="locked">
                🔒 아직 열리지 않은 보드입니다. 선생님이 열면 쓸 수 있어요.
              </div>
            ) : (
              <Kanban view={view} isTeacher={isTeacher} onChanged={refetchView} />
            )}
          </>
        )}
      </main>
      {settings && view && (
        <BoardSettings
          view={view}
          projectId={project.id}
          tree={tree}
          students={students}
          permissions={permissions}
          myCriteria={myCriteria}
          onChanged={() => {
            refetchView();
            refetchTree();
          }}
          onClose={() => {
            setSettings(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
