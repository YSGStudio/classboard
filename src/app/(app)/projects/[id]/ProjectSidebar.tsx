"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { AddRootBoard, BoardTree } from "@/components/BoardTree";
import { getBrowserClient } from "@/lib/supabase/client";
import { useProjectEvents } from "@/hooks/useProjectEvents";
import type { TreeNode } from "@/lib/types";
import { loadCardCounts } from "@/lib/board-counts";


export function ProjectSidebar({
  projectId,
  title,
  initialNodes,
  initialCounts,
  isTeacher,
}: {
  projectId: string;
  title: string;
  initialNodes: TreeNode[];
  initialCounts: Record<string, number>;
  isTeacher: boolean;
}) {
  const params = useParams<{ boardId?: string }>();
  const pathname = usePathname();
  const onSettings = pathname.endsWith("/settings");
  const currentId = params.boardId;
  const [nodes, setNodes] = useState(initialNodes);
  const [counts, setCounts] = useState(initialCounts);
  const [seen, setSeen] = useState({ initialNodes, initialCounts });
  if (seen.initialNodes !== initialNodes || seen.initialCounts !== initialCounts) {
    setSeen({ initialNodes, initialCounts });
    setNodes(initialNodes);
    setCounts(initialCounts);
  }

  const refetch = useCallback(
    async (structure: boolean) => {
      let ids = nodes.map((n) => n.id);
      if (structure) {
        const { data } = await getBrowserClient().rpc("get_board_tree", { p_project: projectId });
        if (data) {
          setNodes(data as TreeNode[]);
          ids = (data as TreeNode[]).map((n) => n.id);
        }
      }
      setCounts(await loadCardCounts(getBrowserClient(), ids));
    },
    [nodes, projectId],
  );

  useProjectEvents(projectId, (evs) => {
    refetch(evs.some((e) => e.scope === "structure"));
  });

  const boardCount = nodes.filter((n) => n.accessible).length;
  // 작업장 설정 페이지는 자체 작업장 리스트가 있으므로 사이드바를 숨긴다
  if (onSettings) return null;

  return (
    <aside
      className="flex flex-col gap-3 rounded-[20px] bg-primary p-3 text-white shadow-[0_4px_0_var(--shadow)] lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:w-72 lg:shrink-0"
      data-testid="project-sidebar"
    >
      <Link
        href={`/projects/${projectId}`}
        aria-current={currentId ? undefined : "page"}
        className={`flex min-h-12 items-center gap-2 rounded-xl px-3 transition ${currentId ? "hover:bg-white/10" : "bg-white/15"}`}
      >
        <span aria-hidden>🏠</span>
        <span className="jua min-w-0 flex-1 truncate text-xl" title={title}>
          {title}
        </span>
      </Link>
      <div className="flex flex-wrap items-center gap-2 border-t-2 border-white/15 px-1 pt-3">
        <h2 className="text-2xl text-white">
          작업장 <span className="text-accent">{boardCount}</span>
        </h2>
        {isTeacher && (
          <div className="flex w-full flex-wrap gap-2">
            <AddRootBoard projectId={projectId} />
            <Link
              href={`/projects/${projectId}/settings${currentId ? `?board=${currentId}` : ""}`}
              className="btn-ghost min-h-10 px-3"
              data-testid="workspace-settings-link"
            >
              ⚙ 작업장 설정
            </Link>
          </div>
        )}
      </div>
      <details className="group lg:hidden" open={!currentId}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-xl px-3 text-sm font-bold text-primary-soft hover:bg-white/10">
          <span className="group-open:hidden">▸ 작업장 목록 펼치기</span>
          <span className="hidden group-open:inline">▾ 작업장 목록 접기</span>
        </summary>
        <div className="mt-1">
          <BoardTree projectId={projectId} nodes={nodes} currentId={currentId} isTeacher={isTeacher} counts={counts} />
        </div>
      </details>
      <div className="hidden min-h-0 overflow-y-auto pr-1 lg:block">
        <BoardTree projectId={projectId} nodes={nodes} currentId={currentId} isTeacher={isTeacher} counts={counts} />
      </div>
    </aside>
  );
}
