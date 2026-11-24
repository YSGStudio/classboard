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
import { positionBetween } from "@/lib/columns";
import { createCard, moveCard } from "@/app/actions/cards";
import { AttachmentThumbs } from "@/components/attachments/AttachmentList";
import { CardModal } from "./CardModal";

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

  const step = (card: CardView, dir: -1 | 1) => {
    const i = columns.findIndex((c) => c.id === card.column_id);
    const target = columns[i + dir];
    if (!target) return;
    doMove(card, target.id, (byColumn.get(target.id) ?? []).length);
  };

  const openCard = cards.find((c) => c.id === openId) ?? null;
  const canWrite = view.board.can_write && !readOnly;

  return (
    <>
      {error && (
        <p role="alert" className="alert-error mx-3 mb-3">
          {error}
        </p>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="flex w-full snap-x items-start gap-[22px] overflow-x-auto px-3 pt-1 pb-6" data-testid="kanban">
          {columns.map((col, i) => (
            <Column
              key={col.id}
              col={col}
              cards={byColumn.get(col.id) ?? []}
              isTeacher={isTeacher}
              canWrite={canWrite}
              boardId={view.board.id}
              isFirst={i === 0}
              isLast={i === columns.length - 1}
              nextIsLast={i === columns.length - 2}
              readOnly={!!readOnly}
              onOpen={setOpenId}
              onStep={step}
              onChanged={onChanged}
            />
          ))}
        </div>
      </DndContext>
      {openCard && (
        <CardModal
          card={readOnly ? { ...openCard, can_edit: false } : openCard}
          boardId={view.board.id}
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
  isFirst,
  isLast,
  nextIsLast,
  readOnly,
  onOpen,
  onStep,
  onChanged,
}: {
  col: ColumnView;
  cards: CardView[];
  isTeacher: boolean;
  canWrite: boolean;
  boardId: string;
  isFirst: boolean;
  isLast: boolean;
  nextIsLast: boolean;
  readOnly: boolean;
  onOpen: (id: string) => void;
  onStep: (card: CardView, dir: -1 | 1) => void;
  onChanged: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.id}` });
  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-[200px] w-[82vw] max-w-[22rem] shrink-0 snap-start flex-col gap-3.5 rounded-[18px] p-1.5 transition-colors sm:w-[300px] ${isOver ? "bg-primary/8 outline-[3px] outline-edge outline-dashed" : ""}`}
      aria-label={`${col.name} 열`}
      data-testid="column"
      data-column-name={col.name}
    >
      <header className="flex flex-wrap items-center gap-2 px-1">
        <span className="size-3 shrink-0 rounded-full ring-2 ring-white" style={{ background: col.color }} aria-hidden />
        <h3 className="jua min-w-0 flex-1 truncate text-[26px] leading-tight text-ink">{col.name}</h3>
        <span className="count-pill" data-testid="column-count">
          {cards.length + col.hidden_count}
        </span>
        {isTeacher && col.effective_hide !== "off" && (
          <span className="badge w-full justify-center bg-amber-100 text-amber-800">가리기: {HIDE_MODE_LABEL[col.effective_hide]}</span>
        )}
      </header>
      {canWrite && isFirst && <AddCard boardId={boardId} columnId={col.id} lastPosition={cards.at(-1)?.position ?? 0} onAdded={onChanged} />}
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex min-h-12 flex-col gap-3.5">
          {cards.length === 0 && col.hidden_count === 0 && (
            <li className="py-4 text-center text-sm text-muted">{isFirst ? "새 카드를 만들어 보세요" : "카드를 여기로 끌어오거나 버튼으로 옮겨요"}</li>
          )}
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              isFirst={isFirst}
              isLast={isLast}
              nextIsLast={nextIsLast}
              readOnly={readOnly}
              onOpen={() => onOpen(card.id)}
              onStep={(d) => onStep(card, d)}
            />
          ))}
          {col.hidden_count > 0 && (
            <li className="rounded-2xl border-2 border-dashed border-edge bg-white/50 p-3 text-center text-sm font-medium text-muted" data-testid="hidden-count">
              다른 친구 카드 {col.hidden_count}개
            </li>
          )}
        </ul>
      </SortableContext>
      {canWrite && !isFirst && <AddCard boardId={boardId} columnId={col.id} lastPosition={cards.at(-1)?.position ?? 0} onAdded={onChanged} />}
    </section>
  );
}

function CardItem({
  card,
  isFirst,
  isLast,
  nextIsLast,
  readOnly,
  onOpen,
  onStep,
}: {
  card: CardView;
  isFirst: boolean;
  isLast: boolean;
  nextIsLast: boolean;
  readOnly: boolean;
  onOpen: () => void;
  onStep: (d: -1 | 1) => void;
}) {
  const movable = card.can_edit && !readOnly;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !movable });
  const done = card.checklist.filter((c) => c.done).length;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={`flex flex-col gap-3 rounded-2xl px-[18px] py-4 ${isLast ? "bg-done" : "bg-card"} ${
        card.is_mine && !isLast ? "border-[3px] border-accent" : isLast ? "" : "shadow-[0_4px_0_var(--shadow)]"
      }`}
      data-testid="card"
      data-card-title={card.title}
    >
      <div {...attributes} {...listeners} className={`flex flex-col gap-2 ${movable ? "cursor-grab touch-manipulation" : ""}`}>
        <button type="button" className="flex w-full items-start gap-3 text-left" onClick={onOpen}>
          {isLast && <StarIcon />}
          <span className="flex min-w-0 flex-1 flex-col gap-2">
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
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
              <span data-testid="card-author" className={card.is_mine ? "font-bold text-ink" : ""}>
                {card.author_name ?? (card.is_mine ? "나" : "익명")}
              </span>
              {card.due_date && <span>· 마감 {card.due_date}</span>}
              {card.checklist.length > 0 && (
                <span className={done === card.checklist.length ? "font-bold text-emerald-800" : ""}>
                  · ☑ {done}/{card.checklist.length}
                </span>
              )}
            </span>
          </span>
        </button>
        <AttachmentThumbs items={card.attachments} />
      </div>
      {movable && (
        <div className="flex gap-2">
          <button type="button" className="icon-btn" disabled={isFirst} onClick={() => onStep(-1)} aria-label="이전 단계로" title="이전 단계로">
            <BackIcon />
          </button>
          {!isLast && (
            <button
              type="button"
              className={`${nextIsLast ? "btn-gold" : "btn-primary"} flex-1`}
              onClick={() => onStep(1)}
              aria-label="다음 단계로"
            >
              다음 단계로 ▶
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function AddCard({
  boardId,
  columnId,
  lastPosition,
  onAdded,
}: {
  boardId: string;
  columnId: string;
  lastPosition: number;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className="add-btn w-full" onClick={() => setOpen(true)}>
        ＋ 카드 추가
      </button>
    );
  }
  return (
    <form
      className="card-panel flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createCard(boardId, columnId, { title, body: "", labels: [], due_date: null, checklist: [] }, lastPosition + 1);
          if (!r.ok) return setError(r.error);
          setTitle("");
          setError("");
          onAdded();
        });
      }}
    >
      <textarea
        autoFocus
        aria-label="새 카드 제목"
        className="input h-20"
        maxLength={100}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            (e.currentTarget.form as HTMLFormElement).requestSubmit();
          }
        }}
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={pending || !title.trim()}>
          추가
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          취소
        </button>
      </div>
    </form>
  );
}

function StarIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="#FFD166" stroke="#8A5A00" strokeWidth="1.5" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2L2.9 9.4l6.3-.9z" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </svg>
  );
}
