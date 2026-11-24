"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Access, BoardView, TreeNode } from "@/lib/types";
import type { Criterion } from "@/lib/criteria";
import { HIDE_MODE_LABEL, type HideMode } from "@/lib/hiding";
import { MAX_COLUMNS, MIN_COLUMNS } from "@/lib/columns";
import { descendants } from "@/lib/tree";
import {
  addColumn,
  createPersonalBoards,
  deleteBoard,
  deleteColumn,
  moveBoard,
  reorderBoard,
  reorderColumn,
  setStudentPermissions,
  updateBoardSettings,
  updateColumn,
} from "@/app/actions/boards";
import { attachCriterion, detachCriterion, reorderBoardCriterion } from "@/app/actions/criteria";
import { CriterionForm } from "@/components/criteria/CriterionForm";

export type StudentLite = { id: string; display_name: string; login_id: string; active: boolean };
export type PermissionRow = { student_id: string; access: Access };

const ACCESS_LABEL: Record<Access, string> = { none: "없음", read: "읽기", edit: "수정" };
const TABS = ["일반", "열", "가리기", "권한", "개인 보드", "평가 기준"] as const;
type Tab = (typeof TABS)[number];

export function BoardSettings({
  view,
  projectId,
  projectFlow,
  tree,
  students,
  permissions,
  myCriteria,
  onChanged,
  onClose,
}: {
  view: BoardView;
  projectId: string;
  projectFlow: "sequential" | "parallel";
  tree: TreeNode[];
  students: StudentLite[];
  permissions: PermissionRow[];
  myCriteria: Criterion[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("일반");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const b = view.board;
  const personal = b.kind === "personal";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "실패했습니다.");
        setInfo("");
      } else {
        setError("");
        setInfo(success ?? "");
      }
      onChanged();
      router.refresh();
    });

  const tabs = personal ? TABS.filter((t) => t !== "가리기" && t !== "개인 보드" && t !== "평가 기준") : TABS;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[rgba(20,27,54,.45)]" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-card shadow-[0_20px_60px_rgba(20,27,54,.35)]"
        onClick={(e) => e.stopPropagation()}
        aria-label="보드 설정"
        role="dialog"
      >
        <div className="flex items-center gap-2 border-b-2 border-surface p-3">
          <h2 className="font-bold">보드 설정</h2>
          <button className="ml-auto text-2xl leading-none text-slate-500" onClick={onClose} aria-label="설정 닫기">
            ×
          </button>
        </div>
        <div className="flex flex-wrap gap-1 border-b-2 border-surface px-3 py-2" role="tablist">
          {tabs.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`rounded px-2 py-1 text-sm ${tab === t ? "bg-indigo-600 text-white" : "hover:bg-slate-100"}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-4 p-4">
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {info && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800" data-testid="settings-info">{info}</p>}
          {tab === "일반" && (
            <GeneralTab
              view={view}
              projectId={projectId}
              projectFlow={projectFlow}
              tree={tree}
              pending={pending}
              run={run}
              onDeleted={(parentId) => router.push(parentId ? `/projects/${projectId}/boards/${parentId}` : `/projects/${projectId}`)}
              setError={setError}
            />
          )}
          {tab === "열" && <ColumnsTab view={view} pending={pending} run={run} />}
          {tab === "가리기" && <HidingTab view={view} pending={pending} run={run} />}
          {tab === "권한" && <PermissionsTab view={view} students={students} permissions={permissions} pending={pending} run={run} />}
          {tab === "개인 보드" && <PersonalTab view={view} students={students} pending={pending} run={run} />}
          {tab === "평가 기준" && <CriteriaTab view={view} myCriteria={myCriteria} pending={pending} run={run} onChanged={() => { onChanged(); router.refresh(); }} />}
        </div>
      </aside>
    </div>
  );
}

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) => void;

function GeneralTab({
  view,
  projectId,
  projectFlow,
  tree,
  pending,
  run,
  onDeleted,
  setError,
}: {
  view: BoardView;
  projectId: string;
  projectFlow: "sequential" | "parallel";
  tree: TreeNode[];
  pending: boolean;
  run: Run;
  onDeleted: (parentId: string | null) => void;
  setError: (e: string) => void;
}) {
  const b = view.board;
  const [title, setTitle] = useState(b.title);
  const [target, setTarget] = useState<string>(b.parent_id ?? "");
  const [confirm, setConfirm] = useState(false);
  const blocked = descendants(tree, b.id);
  blocked.add(b.id);
  const [, start] = useTransition();
  return (
    <>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateBoardSettings(b.id, { title }), "이름을 바꿨습니다.");
        }}
      >
        <input className="input" aria-label="보드 이름" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
        <button className="btn shrink-0" disabled={pending}>
          이름 저장
        </button>
      </form>
      {projectFlow === "sequential" && b.kind === "shared" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={b.unlocked} onChange={(e) => run(() => updateBoardSettings(b.id, { unlocked: e.target.checked }))} />
          학생에게 이 보드 열기(순차형)
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>순서</span>
        <button className="btn" onClick={() => run(() => reorderBoard(b.id, "up"))} disabled={pending}>
          ▲ 위로
        </button>
        <button className="btn" onClick={() => run(() => reorderBoard(b.id, "down"))} disabled={pending}>
          ▼ 아래로
        </button>
      </div>
      {b.kind === "shared" && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => moveBoard(b.id, target || null), "보드를 옮겼습니다.");
          }}
        >
          <label className="label" htmlFor="move-target">
            다른 보드 아래로 옮기기
          </label>
          <div className="flex gap-2">
            <select id="move-target" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">(최상위)</option>
              {tree
                .filter((n) => n.kind === "shared")
                .map((n) => (
                  <option key={n.id} value={n.id} disabled={blocked.has(n.id)}>
                    {n.title}
                    {blocked.has(n.id) ? " (불가)" : ""}
                  </option>
                ))}
            </select>
            <button className="btn shrink-0" disabled={pending}>
              옮기기
            </button>
          </div>
        </form>
      )}
      <div className="border-t-2 border-surface pt-4">
        {confirm ? (
          <button
            className="btn-danger"
            onClick={() =>
              start(async () => {
                const r = await deleteBoard(b.id);
                if (!r.ok) return setError(r.error);
                onDeleted(r.data?.parentId ?? null);
              })
            }
          >
            정말 삭제(하위 보드·카드 모두 삭제)
          </button>
        ) : (
          <button className="btn-danger" onClick={() => setConfirm(true)}>
            보드 삭제
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">프로젝트: {projectId.slice(0, 8)}</p>
    </>
  );
}

function ColumnsTab({ view, pending, run }: { view: BoardView; pending: boolean; run: Run }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#64748b");
  const cols = [...view.columns].sort((a, b) => a.position - b.position);
  return (
    <>
      <p className="text-sm text-slate-600">
        열은 {MIN_COLUMNS}~{MAX_COLUMNS}개. 지금 {cols.length}개.
      </p>
      <ul className="flex flex-col gap-2">
        {cols.map((c, i) => (
          <ColumnRow key={c.id} c={c} first={i === 0} last={i === cols.length - 1} pending={pending} run={run} />
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addColumn(view.board.id, name, color), "열을 추가했습니다.");
          setName("");
        }}
      >
        <input className="input" aria-label="새 열 이름" placeholder="새 열 이름" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <input type="color" aria-label="새 열 색" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-12 shrink-0" />
        <button className="btn shrink-0" disabled={pending || !name.trim()}>
          열 추가
        </button>
      </form>
    </>
  );
}

function ColumnRow({
  c,
  first,
  last,
  pending,
  run,
}: {
  c: BoardView["columns"][number];
  first: boolean;
  last: boolean;
  pending: boolean;
  run: Run;
}) {
  const [name, setName] = useState(c.name);
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-2" data-testid="column-row">
      <input type="color" aria-label={`${c.name} 색`} value={c.color} onChange={(e) => run(() => updateColumn(c.id, { color: e.target.value }))} className="h-9 w-10" />
      <input
        className="input w-36 py-1"
        aria-label={`${c.name} 이름`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== c.name && run(() => updateColumn(c.id, { name }))}
      />
      <button className="btn px-2" disabled={first || pending} onClick={() => run(() => reorderColumn(c.id, "left"))} aria-label={`${c.name} 왼쪽으로`}>
        ◀
      </button>
      <button className="btn px-2" disabled={last || pending} onClick={() => run(() => reorderColumn(c.id, "right"))} aria-label={`${c.name} 오른쪽으로`}>
        ▶
      </button>
      {confirm ? (
        <button className="btn-danger" onClick={() => run(() => deleteColumn(c.id))}>
          카드까지 삭제
        </button>
      ) : (
        <button className="btn-danger" onClick={() => setConfirm(true)} aria-label={`${c.name} 열 삭제`}>
          삭제
        </button>
      )}
    </li>
  );
}

function HidingTab({ view, pending, run }: { view: BoardView; pending: boolean; run: Run }) {
  const b = view.board;
  const cols = [...view.columns].sort((a, b2) => a.position - b2.position);
  return (
    <>
      <fieldset>
        <legend className="label">가리기 방식(학생에게 다른 학생 카드를)</legend>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(HIDE_MODE_LABEL) as HideMode[]).map((m) => (
            <label key={m} className="flex items-center gap-1 text-sm">
              <input type="radio" name="hide_mode" checked={b.hide_mode === m} disabled={pending} onChange={() => run(() => updateBoardSettings(b.id, { hide_mode: m }))} />
              {HIDE_MODE_LABEL[m]}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">숨김=안 보임 · 개수만=카드 수만 · 익명=내용은 보이고 작성자 숨김. 교사는 항상 전체를 봅니다.</p>
      </fieldset>
      <fieldset>
        <legend className="label">적용할 열</legend>
        {cols.map((c) => (
          <label key={c.id} className="mr-3 inline-flex items-center gap-1 text-sm">
            <input type="checkbox" checked={c.hide_applies} disabled={pending} onChange={(e) => run(() => updateColumn(c.id, { hide_applies: e.target.checked }))} />
            {c.name}
          </label>
        ))}
      </fieldset>
      {b.hide_mode !== "off" && (
        <div className="flex gap-2">
          {b.revealed ? (
            <button className="btn" onClick={() => run(() => updateBoardSettings(b.id, { revealed: false }), "다시 가렸습니다.")}>
              다시 가리기
            </button>
          ) : (
            <button className="btn-primary" onClick={() => run(() => updateBoardSettings(b.id, { revealed: true }), "모두 공개했습니다.")}>
              모두 공개
            </button>
          )}
        </div>
      )}
    </>
  );
}

function PermissionsTab({
  view,
  students,
  permissions,
  pending,
  run,
}: {
  view: BoardView;
  students: StudentLite[];
  permissions: PermissionRow[];
  pending: boolean;
  run: Run;
}) {
  const b = view.board;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const perm = new Map(permissions.map((p) => [p.student_id, p.access]));
  const def = (b.default_access ?? "none") as Access;
  const effective = (id: string): Access => perm.get(id) ?? (b.kind === "personal" && b.owner_id === id ? "edit" : def);
  const all = students.length > 0 && selected.size === students.length;
  const apply = (a: Access | "default") => {
    const ids = [...selected];
    run(() => setStudentPermissions(b.id, ids, a), `${ids.length}명의 권한을 바꿨습니다.`);
  };
  return (
    <>
      <fieldset>
        <legend className="label">기본 권한(모든 학생)</legend>
        <div className="flex gap-3">
          {(["none", "read", "edit"] as Access[]).map((a) => (
            <label key={a} className="flex items-center gap-1 text-sm">
              <input type="radio" name="default_access" checked={def === a} disabled={pending} onChange={() => run(() => updateBoardSettings(b.id, { default_access: a }))} />
              {ACCESS_LABEL[a]}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">학생별 권한이 기본 권한보다 우선합니다. 없음=트리에도 안 보임.</p>
      </fieldset>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-card py-2">
        <span className="text-sm">{selected.size}명 선택</span>
        <button className="btn-primary" disabled={!selected.size || pending} onClick={() => apply("read")}>
          읽기 주기
        </button>
        <button className="btn-primary" disabled={!selected.size || pending} onClick={() => apply("edit")}>
          수정 주기
        </button>
        <button className="btn-danger" disabled={!selected.size || pending} onClick={() => apply("none")}>
          권한 회수
        </button>
        <button className="btn" disabled={!selected.size || pending} onClick={() => apply("default")}>
          기본값 따르기
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-600">
            <th className="p-1">
              <input
                type="checkbox"
                aria-label="전체 선택"
                checked={all}
                onChange={() => setSelected(all ? new Set() : new Set(students.map((s) => s.id)))}
              />
            </th>
            <th className="p-1">학생</th>
            <th className="p-1">권한</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => {
            const explicit = perm.get(s.id);
            return (
              <tr key={s.id} className="border-t-2 border-surface" data-testid={`perm-${s.login_id}`}>
                <td className="p-1">
                  <input
                    type="checkbox"
                    aria-label={`${s.display_name} 선택`}
                    checked={selected.has(s.id)}
                    onChange={() =>
                      setSelected((cur) => {
                        const n = new Set(cur);
                        if (n.has(s.id)) n.delete(s.id);
                        else n.add(s.id);
                        return n;
                      })
                    }
                  />
                </td>
                <td className="p-1">
                  {s.display_name} <span className="text-xs text-slate-500">{s.login_id}</span>
                </td>
                <td className="p-1">
                  {ACCESS_LABEL[effective(s.id)]}
                  {explicit ? <span className="ml-1 text-xs text-indigo-700">(학생별)</span> : <span className="ml-1 text-xs text-slate-400">(기본)</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function PersonalTab({ view, students, pending, run }: { view: BoardView; students: StudentLite[]; pending: boolean; run: Run }) {
  const b = view.board;
  const [mode, setMode] = useState<"all" | "some">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const active = students.filter((s) => s.active);
  return (
    <>
      <p className="text-sm text-slate-700">
        이 보드 바로 아래에 학생마다 개인 하위 보드를 하나씩 만듭니다. 이 보드는 그대로 칸반으로 쓸 수 있습니다. 하위 보드는 이 보드의 열 구성을 복사하고, 배당된 학생만 수정할 수 있습니다.
      </p>
      {b.auto_personal && <p className="rounded-lg bg-indigo-50 p-2 text-sm text-indigo-900">전체 학생 배당됨 — 새로 등록하는 학생에게도 자동으로 만들어집니다.</p>}
      <fieldset className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={mode === "all"} onChange={() => setMode("all")} /> 전체 학생 ({active.length}명, 이후 등록 학생 포함)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={mode === "some"} onChange={() => setMode("some")} /> 선택한 학생만
        </label>
      </fieldset>
      {mode === "some" && (
        <div className="grid max-h-60 grid-cols-2 gap-1 overflow-y-auto rounded-xl border-2 border-edge p-2 text-sm">
          {active.map((s) => (
            <label key={s.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() =>
                  setSelected((cur) => {
                    const n = new Set(cur);
                    if (n.has(s.id)) n.delete(s.id);
                    else n.add(s.id);
                    return n;
                  })
                }
              />
              {s.display_name}
            </label>
          ))}
        </div>
      )}
      <button
        className="btn-primary w-fit"
        disabled={pending || (mode === "some" && !selected.size)}
        onClick={() =>
          run(() => createPersonalBoards(b.id, mode === "all" ? null : [...selected]), "학생별 개인 보드를 만들었습니다.")
        }
      >
        {pending ? "만드는 중…" : "학생별 개인 보드 만들기"}
      </button>
    </>
  );
}

function CriteriaTab({
  view,
  myCriteria,
  pending,
  run,
  onChanged,
}: {
  view: BoardView;
  myCriteria: Criterion[];
  pending: boolean;
  run: Run;
  onChanged: () => void;
}) {
  const b = view.board;
  const attached = new Set(view.criteria.map((c) => c.id));
  const [pick, setPick] = useState("");
  const [creating, setCreating] = useState(false);
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={b.show_criteria} disabled={pending} onChange={(e) => run(() => updateBoardSettings(b.id, { show_criteria: e.target.checked }))} />
        학생에게 기준 미리 보여주기
      </label>
      <ol className="flex flex-col gap-2">
        {view.criteria.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2 rounded-xl border-2 border-edge p-2 text-sm">
            <span className="flex-1">
              {i + 1}. {c.name} <span className="text-xs text-slate-500">({c.levels.length}단계)</span>
            </span>
            <button className="btn px-2" disabled={i === 0} onClick={() => run(() => reorderBoardCriterion(b.id, c.id, "up"))} aria-label="위로">
              ▲
            </button>
            <button className="btn px-2" disabled={i === view.criteria.length - 1} onClick={() => run(() => reorderBoardCriterion(b.id, c.id, "down"))} aria-label="아래로">
              ▼
            </button>
            <button className="btn-danger" onClick={() => run(() => detachCriterion(b.id, c.id))}>
              떼기
            </button>
          </li>
        ))}
        {!view.criteria.length && <li className="text-sm text-slate-500">붙은 기준이 없습니다.</li>}
      </ol>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (pick) run(() => attachCriterion(b.id, pick), "기준을 붙였습니다.");
          setPick("");
        }}
      >
        <select className="input" aria-label="붙일 기준" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">내 기준 목록에서 고르기</option>
          {myCriteria
            .filter((c) => !attached.has(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <button className="btn shrink-0" disabled={!pick || pending}>
          붙이기
        </button>
      </form>
      {creating ? (
        <div className="rounded-xl border-2 border-edge p-3">
          <CriterionForm
            attachToBoardId={b.id}
            onDone={() => {
              setCreating(false);
              onChanged();
            }}
          />
        </div>
      ) : (
        <button className="btn w-fit" onClick={() => setCreating(true)}>
          ＋ 새 기준 만들어 붙이기
        </button>
      )}
    </>
  );
}
