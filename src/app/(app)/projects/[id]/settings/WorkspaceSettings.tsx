"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import type { BoardView, Project, TreeNode } from "@/lib/types";
import type { Criterion } from "@/lib/criteria";
import { childrenMap, computeDrop, roots, type DropPlace } from "@/lib/tree";
import { getBrowserClient } from "@/lib/supabase/client";
import { useProjectEvents } from "@/hooks/useProjectEvents";
import { loadCardCounts } from "@/lib/board-counts";
import {
  createBoard,
  deleteBoard,
  duplicateBoard,
  placeBoard,
  reorderBoard,
  updateBoardSettings,
} from "@/app/actions/boards";
import {
  BoardSettingsPanel,
  type PermissionRow,
  type StudentLite,
  type Tab,
} from "@/components/board/BoardSettings";

type Row = { node: TreeNode; depth: number } | { group: string; depth: number; count: number };

const DROP_MSG: Record<string, string> = {
  cycle: "작업장을 자기 자신이나 하위 작업장 안으로 옮길 수 없어요.",
  personal: "학생 개인 보드는 다른 작업장으로 옮길 수 없어요. 순서만 바꿀 수 있어요.",
};

export function WorkspaceSettings({
  project,
  initialNodes,
  counts: initialCounts,
  students,
  myCriteria,
  initialSelected,
}: {
  project: Project;
  initialNodes: TreeNode[];
  counts: Record<string, number>;
  students: StudentLite[];
  myCriteria: Criterion[];
  initialSelected: string | null;
}) {
  const router = useRouter();
  const [nodes, setNodes] = useState(initialNodes);
  const [counts, setCounts] = useState(initialCounts);
  const [seen, setSeen] = useState({ initialNodes, initialCounts });
  if (seen.initialNodes !== initialNodes || seen.initialCounts !== initialCounts) {
    setSeen({ initialNodes, initialCounts });
    setNodes(initialNodes);
    setCounts(initialCounts);
  }
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [panelTab, setPanelTab] = useState<{ tab: Tab; nonce: number }>({ tab: "일반", nonce: 0 });
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [, start] = useTransition();

  const refetchTree = useCallback(async () => {
    const { data } = await getBrowserClient().rpc("get_board_tree", { p_project: project.id });
    if (data) {
      setNodes(data as TreeNode[]);
      setCounts(await loadCardCounts(getBrowserClient(), (data as TreeNode[]).map((n) => n.id)));
    }
  }, [project.id]);

  // 선택한 작업장이 지워지면 첫 작업장을 고른다
  const selectedNode = nodes.find((n) => n.id === selected) ?? null;
  if (selected && !selectedNode && nodes.length) setSelected(roots(nodes)[0]?.id ?? null);

  const select = (id: string, tab: Tab = "일반") => {
    setSelected(id);
    setMessage(null);
    setPanelTab((p) => ({ tab, nonce: p.nonce + 1 }));
    window.history.replaceState(null, "", `/projects/${project.id}/settings?board=${id}`);
  };

  const done = (text: string) => setMessage({ kind: "info", text });
  const failed = (text: string) => setMessage({ kind: "error", text });

  // ── 트리를 화면 행으로 펼친다. 학생 개인 보드는 부모마다 접힌 묶음으로 둔다.
  const rows = useMemo(() => {
    const kids = childrenMap(nodes);
    const out: Row[] = [];
    const walk = (list: TreeNode[], depth: number) => {
      for (const n of list) {
        out.push({ node: n, depth });
        const children = kids.get(n.id) ?? [];
        const shared = children.filter((c) => c.kind === "shared");
        const personal = children.filter((c) => c.kind === "personal");
        walk(shared, depth + 1);
        if (personal.length) {
          out.push({ group: n.id, depth: depth + 1, count: personal.length });
          if (openGroups.has(n.id)) walk(personal, depth + 2);
        }
      }
    };
    walk(roots(nodes), 0);
    return out;
  }, [nodes, openGroups]);

  // ── 드래그 앤 드롭
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );
  const [drop, setDrop] = useState<DropPlace | null>(null);
  const placeFrom = (e: DragMoveEvent | DragEndEvent): DropPlace | null => {
    if (!e.over || e.over.id === e.active.id) return null;
    const start = e.activatorEvent as PointerEvent | TouchEvent;
    const y0 = "touches" in start ? start.touches[0].clientY : start.clientY;
    const y = y0 + e.delta.y;
    const { top, height } = e.over.rect;
    const where = y < top + height * 0.28 ? "before" : y > top + height * 0.72 ? "after" : "inside";
    return { overId: String(e.over.id), where };
  };
  const onDragEnd = (e: DragEndEvent) => {
    const place = placeFrom(e);
    setDrop(null);
    if (!place) return;
    const movingId = String(e.active.id);
    const r = computeDrop(nodes, movingId, place);
    if (!r.ok) {
      if (DROP_MSG[r.reason]) failed(DROP_MSG[r.reason]);
      return;
    }
    const before = nodes;
    // 낙관적 반영: 새 부모와 순서를 바로 보여 준다
    setNodes(
      nodes.map((n) => {
        const i = r.order.indexOf(n.id);
        if (i < 0) return n;
        return { ...n, parent_id: n.id === movingId ? r.parentId : n.parent_id, position: i + 1 };
      }),
    );
    if (r.parentId) setOpenGroups((s) => (nodes.find((n) => n.id === movingId)?.kind === "personal" ? new Set(s).add(r.parentId!) : s));
    start(async () => {
      const res = await placeBoard(movingId, place);
      if (!res.ok) {
        setNodes(before);
        failed(res.error);
      } else done("작업장을 옮겼어요.");
      router.refresh();
    });
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) failed(r.error ?? "실패했어요.");
      else {
        done(success);
        after?.();
      }
      await refetchTree();
      router.refresh();
    });

  useProjectEvents(project.id, (evs) => {
    if (evs.some((e) => e.scope === "structure")) refetchTree();
  });

  const sharedCount = nodes.filter((n) => n.kind === "shared").length;

  return (
    <main className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <h1 className="text-[32px] leading-tight sm:text-4xl">
          ⚙ 프로젝트 작업장 <span className="text-primary underline decoration-accent decoration-4 underline-offset-4">설정하기</span>
        </h1>
        <p className="text-sm text-muted">작업장을 추가·수정·복제·삭제하거나 끌어서 순서와 위치를 바꾸고, 작업장마다 상세 설정을 할 수 있어요.</p>
        <Link href={`/projects/${project.id}`} className="btn ml-auto">
          ← {project.title}
        </Link>
      </header>

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={message.kind === "error" ? "alert-error" : "rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800"}
          data-testid="workspace-message"
        >
          {message.text}
          <button type="button" className="ml-2 text-xs underline" onClick={() => setMessage(null)}>
            닫기
          </button>
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,400px)_1fr] lg:items-stretch">
        {/* 작업장 리스트 */}
        <section className="card-panel flex flex-col gap-3 p-4 lg:min-h-[calc(100vh-11rem)]" aria-labelledby="ws-list-h">
          <div className="flex flex-wrap items-center gap-2 border-b-2 border-surface pb-3">
            <h2 id="ws-list-h" className="text-[26px]">
              📦 작업장 리스트 <span className="text-muted">{sharedCount}</span>
            </h2>
            <AddWorkspace
              onAdd={(title) =>
                run(
                  async () => {
                    const r = await createBoard({ projectId: project.id, parentId: null, title });
                    if (r.ok && r.data) select(r.data.id);
                    return r;
                  },
                  `'${title}' 작업장을 만들었어요.`,
                )
              }
            />
          </div>
          <p className="hint">⠿ 손잡이를 끌어 작업장의 위·아래에 놓으면 순서가, 가운데에 놓으면 그 안(하위)으로 들어가요.</p>
          <DndContext
            id="workspace-tree"
            sensors={sensors}
            onDragMove={(e) => setDrop(placeFrom(e))}
            onDragCancel={() => setDrop(null)}
            onDragEnd={onDragEnd}
          >
            <ul className="-mx-1 flex flex-col gap-1.5 px-1 pb-2" data-testid="workspace-list">
              {rows.map((row) =>
                "group" in row ? (
                  <li key={`g:${row.group}`} style={{ paddingLeft: row.depth * 22 }}>
                    <button
                      type="button"
                      className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-bold text-muted hover:bg-surface"
                      aria-expanded={openGroups.has(row.group)}
                      onClick={() =>
                        setOpenGroups((s) => {
                          const n = new Set(s);
                          if (n.has(row.group)) n.delete(row.group);
                          else n.add(row.group);
                          return n;
                        })
                      }
                    >
                      ↳ 👤 학생별 보드 {row.count}개 {openGroups.has(row.group) ? "▾" : "▸"}
                    </button>
                  </li>
                ) : (
                  <WorkspaceRow
                    key={row.node.id}
                    node={row.node}
                    depth={row.depth}
                    count={counts[row.node.id] ?? 0}
                    selected={row.node.id === selected}
                    drop={drop?.overId === row.node.id ? drop.where : null}
                    onSelect={() => select(row.node.id)}
                    onRename={(title) => run(() => updateBoardSettings(row.node.id, { title }), "이름을 바꿨어요.")}
                    onDuplicate={() =>
                      run(
                        async () => {
                          const r = await duplicateBoard(row.node.id);
                          if (r.ok && r.data) select(r.data.id);
                          return r;
                        },
                        `'${row.node.title}' 작업장을 복제했어요. (카드는 복사하지 않아요)`,
                      )
                    }
                    onAddChild={(title) =>
                      run(
                        () => createBoard({ projectId: project.id, parentId: row.node.id, title }),
                        `'${row.node.title}' 아래에 '${title}' 작업장을 만들었어요.`,
                      )
                    }
                    onPersonal={() => select(row.node.id, "개인 보드")}
                    onCriteria={() => select(row.node.id, "평가 기준")}
                    onMove={(dir) => run(() => reorderBoard(row.node.id, dir), "순서를 바꿨어요.")}
                    onDelete={() =>
                      run(
                        () => deleteBoard(row.node.id),
                        `'${row.node.title}' 작업장을 지웠어요.`,
                        () => setSelected(null),
                      )
                    }
                  />
                ),
              )}
              {nodes.length === 0 && <li className="py-8 text-center text-sm text-muted">아직 작업장이 없어요. ＋ 작업장 추가로 시작해 보세요.</li>}
            </ul>
          </DndContext>
        </section>

        {/* 상세 설정 */}
        <section className="card-panel min-w-0 p-5 sm:p-6 lg:min-h-[calc(100vh-11rem)]" aria-labelledby="ws-detail-h">
          {selectedNode ? (
            <DetailPanel
              key={`${selectedNode.id}:${panelTab.nonce}`}
              project={project}
              node={selectedNode}
              nodes={nodes}
              students={students}
              myCriteria={myCriteria}
              initialTab={panelTab.tab}
              onChanged={refetchTree}
              onDeleted={() => {
                setSelected(null);
                refetchTree();
              }}
            />
          ) : (
            <p id="ws-detail-h" className="py-16 text-center text-muted">
              왼쪽에서 작업장을 고르면 상세 설정이 나와요.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function AddWorkspace({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  if (!open)
    return (
      <button type="button" className="btn-primary ml-auto" onClick={() => setOpen(true)}>
        ＋ 작업장 추가
      </button>
    );
  return (
    <form
      className="flex w-full gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onAdd(title.trim());
        setTitle("");
        setOpen(false);
      }}
    >
      <input
        autoFocus
        className="input"
        aria-label="새 작업장 이름"
        placeholder="새 작업장 이름"
        maxLength={100}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      <button className="btn-primary shrink-0" disabled={!title.trim()}>
        추가
      </button>
      <button type="button" className="btn shrink-0" onClick={() => setOpen(false)}>
        취소
      </button>
    </form>
  );
}

function WorkspaceRow({
  node,
  depth,
  count,
  selected,
  drop,
  onSelect,
  onRename,
  onDuplicate,
  onAddChild,
  onPersonal,
  onCriteria,
  onMove,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  count: number;
  selected: boolean;
  drop: DropPlace["where"] | null;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDuplicate: () => void;
  onAddChild: (title: string) => void;
  onPersonal: () => void;
  onCriteria: () => void;
  onMove: (dir: "up" | "down") => void;
  onDelete: () => void;
}) {
  const shared = node.kind === "shared";
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id: node.id });
  const { setNodeRef: dropRef } = useDroppable({ id: node.id });
  const [mode, setMode] = useState<"view" | "rename" | "child">("view");
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenu(false);
        setConfirmDelete(false);
      }
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const item = "flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium hover:bg-surface";
  const pick = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };

  return (
    <li style={{ paddingLeft: depth * 22 }} data-testid="workspace-row" data-title={node.title}>
      <div
        ref={(el) => {
          dragRef(el);
          dropRef(el);
        }}
        className={`relative flex min-h-12 items-center gap-1 rounded-2xl border-2 pr-1 transition ${
          selected ? "border-primary bg-primary-soft/40" : "border-surface bg-card hover:border-edge"
        } ${isDragging ? "opacity-40" : ""} ${drop === "inside" ? "ring-[3px] ring-accent" : ""}`}
      >
        {drop === "before" && <span className="absolute -top-1 right-2 left-2 h-1 rounded bg-accent" aria-hidden />}
        {drop === "after" && <span className="absolute right-2 -bottom-1 left-2 h-1 rounded bg-accent" aria-hidden />}
        <button
          type="button"
          className="flex size-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-xl text-lg text-muted hover:bg-surface active:cursor-grabbing"
          aria-label={`${node.title} 끌어서 옮기기`}
          title="끌어서 옮기기"
          {...listeners}
          {...attributes}
        >
          ⠿
        </button>
        {depth > 0 && (
          <span className="text-muted" aria-hidden>
            ↳
          </span>
        )}
        {mode === "view" ? (
          <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-1 text-left" onClick={onSelect} aria-current={selected ? "true" : undefined}>
            <span className={`truncate text-[15px] ${selected ? "font-bold text-ink" : "text-ink"}`}>
              {!shared && "👤 "}
              {node.title}
            </span>
            {node.locked && <span className="shrink-0 text-xs">🔒</span>}
          </button>
        ) : (
          <form
            className="flex min-w-0 flex-1 gap-1 py-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              if (mode === "rename") onRename(text.trim());
              else onAddChild(text.trim());
              setMode("view");
            }}
          >
            <input
              autoFocus
              className="input min-h-9 py-1"
              aria-label={mode === "rename" ? "작업장 새 이름" : "하위 작업장 이름"}
              placeholder={mode === "rename" ? "새 이름" : "하위 작업장 이름"}
              maxLength={100}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setMode("view")}
            />
            <button className="btn-primary min-h-9 shrink-0 px-3 text-sm" disabled={!text.trim()}>
              저장
            </button>
          </form>
        )}
        <span className="shrink-0 px-1 text-sm text-muted tabular-nums" title="카드 수" data-testid="workspace-count">
          {count}
        </span>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className="flex size-10 items-center justify-center rounded-xl text-xl text-muted hover:bg-surface hover:text-ink"
            aria-label={`${node.title} 메뉴`}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            ⋮
          </button>
          {menu && (
            <div role="menu" className="absolute top-11 right-0 z-30 flex w-56 flex-col gap-0.5 rounded-2xl bg-card p-2 shadow-[0_20px_60px_rgba(20,27,54,.35)]">
              <button role="menuitem" className={item} onClick={pick(() => { setText(node.title); setMode("rename"); })}>
                ✏️ 이름 바꾸기
              </button>
              {shared && (
                <>
                  <button role="menuitem" className={item} onClick={pick(onDuplicate)}>
                    📄 복제하기
                  </button>
                  <button role="menuitem" className={item} onClick={pick(() => { setText(""); setMode("child"); })}>
                    ＋ 하위 작업장 추가
                  </button>
                  <button role="menuitem" className={item} onClick={pick(onPersonal)}>
                    👤 학생별 보드 추가
                  </button>
                  <button role="menuitem" className={item} onClick={pick(onCriteria)}>
                    ⭐ 평가 기준 설정
                  </button>
                </>
              )}
              <button role="menuitem" className={item} onClick={pick(() => onMove("up"))}>
                ▲ 위로
              </button>
              <button role="menuitem" className={item} onClick={pick(() => onMove("down"))}>
                ▼ 아래로
              </button>
              <div className="my-1 border-t-2 border-surface" />
              {confirmDelete ? (
                <button role="menuitem" className={`${item} bg-red-50 font-bold text-danger`} onClick={pick(onDelete)}>
                  정말 삭제 (하위·카드 모두)
                </button>
              ) : (
                <button role="menuitem" className={`${item} text-danger`} onClick={() => setConfirmDelete(true)}>
                  🗑 삭제
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** 오른쪽: 선택한 작업장의 상세 설정 */
function DetailPanel({
  project,
  node,
  nodes,
  students,
  myCriteria,
  initialTab,
  onChanged,
  onDeleted,
}: {
  project: Project;
  node: TreeNode;
  nodes: TreeNode[];
  students: StudentLite[];
  myCriteria: Criterion[];
  initialTab: Tab;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [view, setView] = useState<BoardView | null>(null);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const load = useCallback(async () => {
    const sb = getBrowserClient();
    const [{ data: v }, { data: p }] = await Promise.all([
      sb.rpc("get_board_view", { p_board: node.id }),
      sb.from("board_permissions").select("student_id, access").eq("board_id", node.id),
    ]);
    setView((v as BoardView | null) ?? null);
    setPermissions((p ?? []) as PermissionRow[]);
  }, [node.id]);
  useEffect(() => {
    // 작업장을 바꿀 때마다 그 작업장의 설정을 불러온다
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="ws-detail-h" className="min-w-0 text-[26px] leading-tight break-keep">
          📦 <span className="text-primary">[{node.title}]</span> 상세설정
        </h2>
        <span className={`badge ${node.kind === "personal" ? "bg-primary-soft text-primary" : "bg-surface text-muted"}`}>
          {node.kind === "personal" ? "학생 개인 보드" : "작업장"}
        </span>
        <Link href={`/projects/${project.id}/boards/${node.id}`} className="btn ml-auto">
          보드 열기 →
        </Link>
      </div>
      {view ? (
        <BoardSettingsPanel
          view={view}
          projectId={project.id}
          tree={nodes}
          students={students}
          permissions={permissions}
          myCriteria={myCriteria}
          initialTab={initialTab}
          onChanged={() => {
            load();
            onChanged();
          }}
          onDeleted={onDeleted}
        />
      ) : (
        <p className="py-10 text-center text-sm text-muted">불러오는 중…</p>
      )}
    </div>
  );
}
