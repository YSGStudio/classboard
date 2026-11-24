"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { childrenMap, pathTo, roots } from "@/lib/tree";
import type { TreeNode } from "@/lib/types";
import { createBoard } from "@/app/actions/boards";

export function BoardTree({
  projectId,
  nodes,
  currentId,
  isTeacher,
}: {
  projectId: string;
  nodes: TreeNode[];
  currentId?: string;
  isTeacher: boolean;
}) {
  const kids = childrenMap(nodes);
  const initialOpen = new Set(currentId ? pathTo(nodes, currentId).map((n) => n.id) : []);
  const [open, setOpen] = useState<Set<string>>(initialOpen);
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
    return (
      <li key={n.id}>
        <div
          className={`group flex min-h-11 items-center gap-1 rounded-xl px-1 ${n.id === currentId ? "bg-primary font-bold text-white" : "hover:bg-surface"}`}
          style={{ paddingLeft: Math.min(depth, 12) * 12 }}
        >
          {c.length > 0 ? (
            <button
              type="button"
              className={`size-8 shrink-0 rounded-lg ${n.id === currentId ? "text-primary-soft" : "text-muted"}`}
              aria-label={isOpen ? `${n.title} 접기` : `${n.title} 펼치기`}
              aria-expanded={isOpen}
              onClick={() => toggle(n.id)}
            >
              {isOpen ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-8 shrink-0" />
          )}
          {n.accessible ? (
            <Link
              href={`/projects/${projectId}/boards/${n.id}`}
              className="flex min-h-11 min-w-0 flex-1 items-center truncate"
              data-testid="tree-board"
              title={n.title}
            >
              {n.kind === "personal" && <span aria-hidden>👤 </span>}
              {n.title}
              {n.locked && <span className={`ml-1 text-xs ${n.id === currentId ? "text-accent" : "text-amber-700"}`}>🔒{isTeacher ? " 닫힘" : " 잠김"}</span>}
              {isTeacher || n.access === "teacher" ? null : n.access === "read" ? (
                <span className="ml-1 text-xs opacity-70">(읽기)</span>
              ) : null}
            </Link>
          ) : (
            <span className="min-w-0 flex-1 truncate text-slate-400" data-testid="tree-board-dim" title="접근 권한 없음">
              {n.title}
            </span>
          )}
          {isTeacher && <AddChild projectId={projectId} parentId={n.id} onAdded={() => setOpen((s) => new Set(s).add(n.id))} />}
        </div>
        {c.length > 0 && isOpen && <ul>{c.map((x) => render(x, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <nav aria-label="보드 트리" className="text-[15px] text-ink">
      <ul>{roots(nodes).map((n) => render(n, 0))}</ul>
      {nodes.length === 0 && <p className="py-3 text-center text-sm text-muted">{isTeacher ? "보드를 만들어 보세요" : "아직 열린 보드가 없어요"}</p>}
      {isTeacher && <AddRoot projectId={projectId} />}
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
        className="size-9 shrink-0 rounded-lg text-base opacity-60 transition hover:bg-white/30 hover:opacity-100 focus-visible:opacity-100"
        aria-label="하위 보드 추가"
        title="하위 보드 추가"
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
        aria-label="하위 보드 이름"
        className="input min-h-9 w-28 px-2 py-1 text-sm"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title && setEditing(false)}
      />
      <button className="btn min-h-9 px-2 text-sm" disabled={pending || !title.trim()}>
        추가
      </button>
    </form>
  );
}

function AddRoot({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-3 flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createBoard({ projectId, parentId: null, title });
          if (!r.ok) return setError(r.error);
          setTitle("");
          setError("");
          router.refresh();
        });
      }}
    >
      <input
        aria-label="새 보드 이름"
        placeholder="새 보드 이름"
        className="input flex-1"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button className="btn shrink-0" disabled={pending || !title.trim()}>
        보드 추가
      </button>
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
    </form>
  );
}
