"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { childrenMap, pathTo, roots } from "@/lib/tree";
import type { TreeNode } from "@/lib/types";
import { createBoard } from "@/app/actions/boards";

/**
 * 프로젝트 방 사이드바의 작업장(보드) 트리. 어두운(primary) 배경 위에 그린다.
 * counts: 보드별 카드 수(보이는 것만)
 */
export function BoardTree({
  projectId,
  nodes,
  currentId,
  isTeacher,
  counts = {},
}: {
  projectId: string;
  nodes: TreeNode[];
  currentId?: string;
  isTeacher: boolean;
  counts?: Record<string, number>;
}) {
  const kids = childrenMap(nodes);
  const [open, setOpen] = useState<Set<string>>(() => new Set(nodes.map((n) => n.id)));
  const [seenCurrent, setSeenCurrent] = useState(currentId);
  if (seenCurrent !== currentId) {
    // 다른 보드로 이동하면 그 보드까지의 경로를 펼친다
    setSeenCurrent(currentId);
    if (currentId) setOpen((s) => new Set([...s, ...pathTo(nodes, currentId).map((n) => n.id)]));
  }
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const render = (n: TreeNode, depth: number) => {
    const c = kids.get(n.id) ?? [];
    const isOpen = open.has(n.id);
    const current = n.id === currentId;
    return (
      <li key={n.id}>
        <div
          className={`group flex min-h-11 items-center gap-1 rounded-xl pr-2 transition ${current ? "bg-accent text-ink" : "hover:bg-white/10"}`}
          style={{ paddingLeft: 4 + Math.min(depth, 8) * 16 }}
        >
          {c.length > 0 ? (
            <button
              type="button"
              className={`size-8 shrink-0 rounded-lg text-sm ${current ? "text-ink" : "text-primary-soft"}`}
              aria-label={isOpen ? `${n.title} 접기` : `${n.title} 펼치기`}
              aria-expanded={isOpen}
              onClick={() => toggle(n.id)}
            >
              {isOpen ? "▾" : "▸"}
            </button>
          ) : (
            <span className={`w-8 shrink-0 text-center text-sm ${current ? "text-ink/60" : "text-primary-soft/60"}`} aria-hidden>
              {depth > 0 ? "↳" : "·"}
            </span>
          )}
          {n.accessible ? (
            <Link
              href={`/projects/${projectId}/boards/${n.id}`}
              className={`flex min-h-11 min-w-0 flex-1 items-center gap-1 ${current ? "font-bold" : ""}`}
              data-testid="tree-board"
              aria-current={current ? "page" : undefined}
              title={n.title}
            >
              <span className="truncate">
                {n.kind === "personal" && <span aria-hidden>👤 </span>}
                {n.title}
              </span>
              {n.locked && <span className="shrink-0 text-xs">🔒</span>}
              {!isTeacher && n.access === "read" && <span className="shrink-0 text-xs opacity-70">(읽기)</span>}
            </Link>
          ) : (
            <span className="min-w-0 flex-1 truncate text-white/40" data-testid="tree-board-dim" title="접근 권한 없음">
              {n.title}
            </span>
          )}
          {isTeacher && <AddChild projectId={projectId} parentId={n.id} onAdded={() => setOpen((s) => new Set(s).add(n.id))} />}
          {n.accessible && (
            <span className={`ml-1 shrink-0 text-sm tabular-nums ${current ? "text-ink" : "text-primary-soft"}`} data-testid="tree-count">
              {counts[n.id] ?? 0}
            </span>
          )}
        </div>
        {c.length > 0 && isOpen && <ul>{c.map((x) => render(x, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <nav aria-label="작업장 목록" className="text-[15px] text-white">
      <ul className="flex flex-col gap-0.5">{roots(nodes).map((n) => render(n, 0))}</ul>
      {nodes.length === 0 && (
        <p className="py-6 text-center text-sm text-primary-soft">{isTeacher ? "작업장을 만들어 보세요" : "아직 열린 작업장이 없어요"}</p>
      )}
    </nav>
  );
}

function AddChild({ projectId, parentId, onAdded }: { projectId: string; parentId: string; onAdded: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();
  if (!editing) {
    return (
      <button
        type="button"
        className="size-8 shrink-0 rounded-lg text-base opacity-0 transition group-hover:opacity-70 hover:bg-white/20 hover:opacity-100 focus-visible:opacity-100"
        aria-label="하위 작업장 추가"
        title="하위 작업장 추가"
        onClick={() => setEditing(true)}
      >
        ＋
      </button>
    );
  }
  return (
    <form
      className="flex gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createBoard({ projectId, parentId, title });
          if (r.ok) {
            setTitle("");
            setEditing(false);
            onAdded();
            router.refresh();
          }
        });
      }}
    >
      <input
        autoFocus
        aria-label="하위 작업장 이름"
        className="input min-h-9 w-28 px-2 py-1 text-sm"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title && setEditing(false)}
      />
      <button className="btn-gold min-h-9 px-2 text-sm" disabled={pending || !title.trim()}>
        추가
      </button>
    </form>
  );
}

/** 사이드바 머리의 "+ 작업장 추가" (최상위 보드) */
export function AddRootBoard({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className="btn-ghost min-h-10 px-3" onClick={() => setOpen(true)}>
        ＋ 작업장 추가
      </button>
    );
  }
  return (
    <form
      className="flex w-full flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createBoard({ projectId, parentId: null, title });
          if (!r.ok) return setError(r.error);
          setTitle("");
          setError("");
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <input
        autoFocus
        aria-label="새 작업장 이름"
        placeholder="새 작업장 이름"
        className="input flex-1"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      <button className="btn-gold shrink-0" disabled={pending || !title.trim()}>
        추가
      </button>
      {error && <p className="w-full text-xs text-red-300">{error}</p>}
    </form>
  );
}
