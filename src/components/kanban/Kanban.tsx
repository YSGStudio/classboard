"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardView, CardView, ColumnView } from "@/lib/types";
import { HIDE_MODE_LABEL } from "@/lib/hiding";
import { COLUMN_PALETTE, columnTint, positionBetween } from "@/lib/columns";
import { createCard, moveCard } from "@/app/actions/cards";
import { addColumn, addMemberColumns } from "@/app/actions/boards";
import { AttachmentThumbs } from "@/components/attachments/AttachmentList";
import { CardModal } from "./CardModal";
import { formatKST } from "@/lib/datetime";
import type { CardField, CardFieldValues } from "@/lib/card-fields";
import { CardContentInputs, CardContentView } from "./CardContent";
import { PeerReviewModal, ReviewSummaryModal, memberName } from "./ReviewModals";

function sortCards(cards: CardView[]) {
  return [...cards].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
}

export function Kanban({
  view,
  isTeacher,
  onChanged,
  readOnly,
}: {
  view: BoardView;
  isTeacher: boolean;
  onChanged: () => void;
  readOnly?: boolean;
}) {
  const [optimistic, setOptimistic] = useState<{ base: CardView[]; cards: CardView[] } | null>(null);
  const cards = optimistic && optimistic.base === view.cards ? optimistic.cards : view.cards;
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [, start] = useTransition();
  const columns = useMemo(() => [...view.columns].sort((a, b) => a.position - b.position), [view.columns]);
  const byColumn = useMemo(() => {
    const m = new Map<string, CardView[]>();
    for (const c of columns) m.set(c.id, []);
    for (const card of sortCards(cards)) m.get(card.column_id)?.push(card);
    return m;
  }, [cards, columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const doMove = (card: CardView, columnId: string, index: number) => {
    const target = (byColumn.get(columnId) ?? []).filter((c) => c.id !== card.id);
    const prev = target[index - 1]?.position ?? null;
    const next = target[index]?.position ?? null;
    const position = positionBetween(prev, next);
    if (card.column_id === columnId && card.position === position) return;
    const updated = cards.map((c) => (c.id === card.id ? { ...c, column_id: columnId, position } : c));
    setOptimistic({ base: view.cards, cards: updated });
    start(async () => {
      const r = await moveCard(card.id, columnId, position);
      if (!r.ok) {
        setError(r.error);
        setOptimistic(null);
      } else setError("");
      onChanged();
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const card = cards.find((c) => c.id === active.id);
    if (!card || !card.can_edit) return;
    const overId = String(over.id);
    if (overId.startsWith("col:")) {
      const colId = overId.slice(4);
      doMove(card, colId, (byColumn.get(colId) ?? []).filter((c) => c.id !== card.id).length);
      return;
    }
    const overCard = cards.find((c) => c.id === overId);
    if (!overCard || overCard.id === card.id) return;
    const list = (byColumn.get(overCard.column_id) ?? []).filter((c) => c.id !== card.id);
    let idx = list.findIndex((c) => c.id === overCard.id);
    const original = byColumn.get(overCard.column_id) ?? [];
    if (card.column_id === overCard.column_id && original.indexOf(card) < original.indexOf(overCard)) idx += 1;
    doMove(card, overCard.column_id, idx);
  };

  const openCard = cards.find((c) => c.id === openId) ?? null;
  const canWrite = view.board.can_write && !readOnly;
  const template = view.board.card_fields ?? [];
  const [review, setReview] = useState<{ mode: "peer" | "summary"; id: string; name: string } | null>(null);
  // 섹션 주인에 따라: 내 섹션 → 내 평가 보기, 친구 섹션 → 평가하기(동료평가가 켜져 있고 기준이 있을 때), 교사 → 그 학생 평가 보기
  const reviewAction = (col: ColumnView): "summary" | "peer" | null => {
    if (readOnly || !col.member_id) return null;
    if (isTeacher || col.member_id === view.board.viewer_id) return "summary";
    if (view.board.kind === "shared" && view.board.peer_review && view.criteria.length > 0) return "peer";
    return null;
  };

  return (
    <>
      {error && (
        <p role="alert" className="alert-error mx-1 mb-3">
          {error}
        </p>
      )}
      {columns.length === 0 &&
        (isTeacher && !readOnly ? (
          <EmptyBoard boardId={view.board.id} memberSplit={view.board.kind === "shared"} onChanged={onChanged} />
        ) : (
          <div className="card-panel mx-1 flex flex-col items-center gap-2 py-12 text-center" data-testid="empty-board">
            <p className="jua text-2xl text-ink">아직 빈 보드예요</p>
            <p className="text-sm text-muted">선생님이 카드 섹션을 준비하고 있어요.</p>
          </div>
        ))}
      <DndContext id={`kanban-${view.board.id}`} sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="flex w-full snap-x items-start gap-4 overflow-x-auto px-1 pt-1 pb-6" data-testid="kanban">
          {columns.map((col) => (
            <Column
              key={col.id}
              col={col}
              cards={byColumn.get(col.id) ?? []}
              isTeacher={isTeacher}
              canWrite={canWrite}
              boardId={view.board.id}
              template={template}
              readOnly={!!readOnly}
              reviewAction={reviewAction(col)}
              isMine={!!col.member_id && col.member_id === view.board.viewer_id}
              onReview={(mode) => setReview({ mode, id: col.member_id!, name: memberName(col.name) })}
              onOpen={setOpenId}
              onChanged={onChanged}
            />
          ))}
          {isTeacher && !readOnly && columns.length > 0 && (
            <SectionAdder boardId={view.board.id} count={columns.length} memberSplit={view.board.kind === "shared"} onChanged={onChanged} />
          )}
        </div>
      </DndContext>
      {review?.mode === "peer" && (
        <PeerReviewModal
          boardId={view.board.evaluation_board_id}
          target={{ id: review.id, name: review.name }}
          criteria={view.criteria}
          onClose={() => setReview(null)}
        />
      )}
      {review?.mode === "summary" && (
        <ReviewSummaryModal
          boardId={view.board.evaluation_board_id}
          student={{ id: review.id, name: review.name }}
          isTeacher={isTeacher}
          onClose={() => setReview(null)}
        />
      )}
      {openCard && (
        <CardModal
          card={readOnly ? { ...openCard, can_edit: false } : openCard}
          boardId={view.board.id}
          template={template}
          columns={columns}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

function Column({
  col,
  cards,
  isTeacher,
  canWrite,
  boardId,
  template,
  readOnly,
  reviewAction,
  isMine,
  onReview,
  onOpen,
  onChanged,
}: {
  col: ColumnView;
  cards: CardView[];
  isTeacher: boolean;
  canWrite: boolean;
  boardId: string;
  template: CardField[];
  readOnly: boolean;
  reviewAction: "summary" | "peer" | null;
  isMine: boolean;
  onReview: (mode: "summary" | "peer") => void;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.id}` });
  const [adding, setAdding] = useState(false);
  return (
    <section
      ref={setNodeRef}
      className={`flex w-[82vw] max-w-[20rem] shrink-0 snap-start flex-col overflow-hidden rounded-[18px] bg-card shadow-[0_4px_0_var(--shadow)] transition sm:w-[280px] ${isOver ? "outline-[3px] outline-primary outline-dashed" : ""}`}
      aria-label={`${col.name} 열`}
      data-testid="column"
      data-column-name={col.name}
      data-member-id={col.member_id ?? undefined}
    >
      <header className="flex min-h-14 items-center gap-2 px-4 py-2" style={{ background: columnTint(col.color) }}>
        <h3 className="jua min-w-0 flex-1 truncate text-[22px] leading-tight text-ink" title={col.name}>
          {col.name}
        </h3>
        {isMine && <span className="badge shrink-0 bg-accent text-ink">나</span>}
        <span className="count-pill" data-testid="column-count">
          {cards.length + col.hidden_count}
        </span>
        {reviewAction && (
          <button
            type="button"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white/80 text-lg leading-none text-ink transition hover:bg-white"
            onClick={() => onReview(reviewAction)}
            aria-label={reviewAction === "peer" ? `${col.name} 평가하기` : isMine ? "내 평가 보기" : `${col.name} 평가 보기`}
            title={reviewAction === "peer" ? "평가하기" : isMine ? "내 평가 보기" : "평가 보기"}
            data-testid={reviewAction === "peer" ? "peer-review-btn" : "review-summary-btn"}
          >
            <span aria-hidden>{reviewAction === "peer" ? "⭐" : "📊"}</span>
          </button>
        )}
        {canWrite && (
          <button
            type="button"
            className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full text-lg leading-none transition ${adding ? "bg-ink text-white shadow-[inset_0_2px_0_rgba(0,0,0,.25)]" : "bg-white/80 text-ink hover:bg-white"}`}
            onClick={() => setAdding((v) => !v)}
            aria-label={`${col.name}에 글쓰기`}
            title={adding ? "글쓰기 닫기" : "글쓰기"}
            aria-pressed={adding}
            data-testid="write-toggle"
          >
            <span aria-hidden>✏️</span>
          </button>
        )}
      </header>
      {isTeacher && col.effective_hide !== "off" && (
        <p className="bg-amber-100 px-4 py-1 text-center text-xs font-bold text-amber-800">가리기: {HIDE_MODE_LABEL[col.effective_hide]}</p>
      )}
      <div className="flex min-h-[200px] flex-col gap-3 bg-surface p-3">
        {canWrite && adding && (
          <AddCard
            boardId={boardId}
            columnId={col.id}
            template={template}
            lastPosition={cards.at(-1)?.position ?? 0}
            onAdded={onChanged}
          />
        )}
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex min-h-12 flex-col gap-3">
            {cards.length === 0 && col.hidden_count === 0 && !adding && (
              <li className="py-6 text-center text-sm text-muted">{canWrite ? "✏️를 눌러 글을 써 보세요" : "아직 카드가 없어요"}</li>
            )}
            {cards.map((card) => (
              <CardItem key={card.id} card={card} template={template} readOnly={readOnly} onOpen={() => onOpen(card.id)} />
            ))}
            {col.hidden_count > 0 && (
              <li className="rounded-2xl border-2 border-dashed border-edge bg-white/60 p-3 text-center text-sm font-medium text-muted" data-testid="hidden-count">
                다른 친구 카드 {col.hidden_count}개
              </li>
            )}
          </ul>
        </SortableContext>
      </div>
    </section>
  );
}

function CardItem({ card, template, readOnly, onOpen }: { card: CardView; template: CardField[]; readOnly: boolean; onOpen: () => void }) {
  const movable = card.can_edit && !readOnly;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !movable });
  const done = card.checklist.filter((c) => c.done).length;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={`flex flex-col gap-2 rounded-2xl bg-card px-4 py-3 shadow-[0_3px_0_var(--shadow)] ${card.is_mine ? "ring-[3px] ring-accent" : ""}`}
      data-testid="card"
      data-card-title={card.title}
    >
      <div {...attributes} {...listeners} className={`flex flex-col gap-2 ${movable ? "cursor-grab touch-manipulation" : ""}`}>
        <button type="button" className="flex w-full flex-col gap-1.5 text-left" onClick={onOpen}>
          {card.labels.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {card.labels.map((l) => (
                <span key={l} className="badge bg-surface text-muted">
                  {l}
                </span>
              ))}
            </span>
          )}
          <span className="jua block text-xl leading-snug break-words break-keep text-ink">{card.title}</span>
          <CardContentView card={card} template={template} preview />
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
            {card.due_date && <span>마감 {card.due_date}</span>}
            {card.checklist.length > 0 && (
              <span className={done === card.checklist.length ? "font-bold text-emerald-800" : ""}>
                · ☑ {done}/{card.checklist.length}
              </span>
            )}
          </span>
        </button>
        <AttachmentThumbs items={card.attachments} />
        <AuthorLine card={card} />
      </div>
    </li>
  );
}

/** 섹션 머리의 ✏️로 여닫는 글쓰기 칸: 제목 + 보드 카드 형식(기본: 내용) */
function AddCard({
  boardId,
  columnId,
  template,
  lastPosition,
  onAdded,
}: {
  boardId: string;
  columnId: string;
  template: CardField[];
  lastPosition: number;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [values, setValues] = useState<CardFieldValues>({});
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="card-panel flex flex-col gap-2.5"
      data-testid="card-composer"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createCard(
            boardId,
            columnId,
            { title, body: template.length ? "" : body, fields: template.length ? values : {}, labels: [], due_date: null, checklist: [] },
            lastPosition + 1,
          );
          if (!r.ok) return setError(r.error);
          setTitle("");
          setBody("");
          setValues({});
          setError("");
          onAdded();
        });
      }}
      onKeyDown={(e) => {
        // 한 줄 칸에서 Enter는 다음 칸으로, Ctrl/⌘+Enter는 올리기
        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
        const t = e.target as HTMLElement;
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        } else if (t.tagName === "INPUT") {
          e.preventDefault();
          const inputs = [...e.currentTarget.querySelectorAll<HTMLElement>("input, textarea")];
          inputs[inputs.indexOf(t) + 1]?.focus();
        }
      }}
    >
      <div>
        <label className="label" htmlFor={`new-${columnId}-title`}>
          제목
        </label>
        <input
          id={`new-${columnId}-title`}
          autoFocus
          className="input"
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="card-input-title"
        />
      </div>
      <CardContentInputs
        template={template}
        body={body}
        onBody={setBody}
        values={values}
        onValues={setValues}
        idPrefix={`new-${columnId}`}
        compact
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button className="btn-primary" disabled={pending || !title.trim()}>
        {pending ? "올리는 중…" : "올리기"}
      </button>
    </form>
  );
}

const AVATAR_COLORS = ["#FF8FA3", "#7FD6A4", "#8EC5FF", "#FFD66B", "#C4A8FF", "#FFB38A"];
function avatarColor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** 카드 아래 작성자 정보: 아바타 · 이름 · 아이디(또는 선생님) · 쓴 시간. 가리기로 숨겨진 작성자는 '익명'. */
export function AuthorLine({ card }: { card: CardView }) {
  const name = card.author_name ?? (card.is_mine ? "나" : null);
  const when = formatKST(card.created_at, "monthDayTime");
  return (
    <div className="flex items-center gap-2 border-t-2 border-surface pt-2" data-testid="card-author">
      <span
        className="jua inline-flex size-8 shrink-0 items-center justify-center rounded-full text-sm text-ink"
        style={{ background: name && card.author_id ? avatarColor(card.author_id) : "var(--surface)" }}
        aria-hidden
      >
        {name ? name.slice(-2) : "?"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className={`truncate text-sm ${card.is_mine ? "font-bold text-ink" : "font-medium text-ink"}`}>
          {name ?? "익명"}
          {card.is_mine && card.author_name && <span className="ml-1 text-xs font-normal text-muted">(나)</span>}
        </span>
        <span className="truncate text-xs text-muted">
          {card.author_role !== "teacher" && card.author_login && `@${card.author_login} · `}
          <time dateTime={card.created_at}>{when}</time>
        </span>
      </span>
      {card.author_role === "teacher" && <span className="badge shrink-0 bg-primary text-white">선생님</span>}
    </div>
  );
}

/** 빈 보드(열 0개)에서 교사가 보는 시작 안내 */
function EmptyBoard({ boardId, memberSplit, onChanged }: { boardId: string; memberSplit: boolean; onChanged: () => void }) {
  return (
    <section className="card-panel mx-1 mb-4 flex flex-col items-center gap-5 px-6 py-10 text-center" data-testid="empty-board">
      <div className="flex flex-col gap-1">
        <p className="jua text-[28px] text-ink">빈 보드예요. 카드 섹션을 어떻게 나눌까요?</p>
        <p className="text-sm text-muted">섹션은 나중에 보드 설정에서 이름·색·순서를 바꾸거나 지울 수 있어요.</p>
      </div>
      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        {memberSplit && (
          <div className="flex flex-col gap-3 rounded-2xl bg-surface p-5 text-left">
            <p className="jua text-xl">👥 멤버별로 나누기</p>
            <p className="text-sm text-muted">학생마다 &lsquo;01. 이름&rsquo; 섹션을 하나씩 만들어요.</p>
            <MemberSplitButton boardId={boardId} onChanged={onChanged} className="btn-primary mt-auto" />
          </div>
        )}
        <div className={`flex flex-col gap-3 rounded-2xl bg-surface p-5 text-left ${memberSplit ? "" : "sm:col-span-2"}`}>
          <p className="jua text-xl">✏️ 직접 만들기</p>
          <p className="text-sm text-muted">공지사항, 모둠, 단계처럼 원하는 섹션을 하나씩 만들어요.</p>
          <AddSectionForm boardId={boardId} count={0} onChanged={onChanged} />
        </div>
      </div>
    </section>
  );
}

/** 열이 있을 때 맨 오른쪽의 "+ 섹션 추가" 칸 */
function SectionAdder({ boardId, count, memberSplit, onChanged }: { boardId: string; count: number; memberSplit: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex w-[82vw] max-w-[20rem] shrink-0 snap-start flex-col gap-2 sm:w-[280px]" data-testid="section-adder">
      {open ? (
        <div className="card-panel flex flex-col gap-3">
          <AddSectionForm boardId={boardId} count={count} onChanged={onChanged} onDone={() => setOpen(false)} />
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            닫기
          </button>
        </div>
      ) : (
        <button type="button" className="add-btn min-h-14 w-full" onClick={() => setOpen(true)}>
          ＋ 섹션 추가
        </button>
      )}
      {memberSplit && <MemberSplitButton boardId={boardId} onChanged={onChanged} className="add-btn min-h-11 w-full" label="👥 빠진 멤버 섹션 채우기" />}
    </div>
  );
}

function AddSectionForm({ boardId, count, onChanged, onDone }: { boardId: string; count: number; onChanged: () => void; onDone?: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addColumn(boardId, name, COLUMN_PALETTE[count % COLUMN_PALETTE.length]);
          if (!r.ok) return setError(r.error);
          setName("");
          setError("");
          onChanged();
          onDone?.();
        });
      }}
    >
      <input
        className="input"
        aria-label="새 섹션 이름"
        placeholder="예: 공지사항, 1모둠, 질문 모음"
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button className="btn-primary" disabled={pending || !name.trim()}>
        섹션 만들기
      </button>
    </form>
  );
}

function MemberSplitButton({
  boardId,
  onChanged,
  className,
  label = "멤버별로 나누기",
}: {
  boardId: string;
  onChanged: () => void;
  className: string;
  label?: string;
}) {
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await addMemberColumns(boardId);
            setMsg(r.ok ? `섹션 ${r.data?.added ?? 0}개를 만들었어요.` : r.error);
            onChanged();
          })
        }
      >
        {pending ? "만드는 중…" : label}
      </button>
      {msg && (
        <p role="status" className="text-center text-xs text-muted">
          {msg}
        </p>
      )}
    </>
  );
}
