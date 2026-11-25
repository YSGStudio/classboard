"use client";

import { useEffect, useState, useTransition } from "react";
import type { Activity, CardView, ChecklistItem, ColumnView } from "@/lib/types";
import { deleteAttachment, deleteCard, getCardActivities, updateCard } from "@/app/actions/cards";
import { AttachmentDetail } from "@/components/attachments/AttachmentList";
import { AttachmentUploader } from "@/components/attachments/AttachmentUploader";
import { columnTint } from "@/lib/columns";
import { formatKST } from "@/lib/datetime";
import type { CardField, CardFieldValues } from "@/lib/card-fields";
import { CardContentInputs, CardContentView } from "./CardContent";

const ACTION_LABEL: Record<Activity["action"], string> = {
  create: "만듦",
  update: "수정함",
  move: "옮김",
  delete: "삭제함",
};

export function CardModal({
  card,
  boardId,
  template,
  columns,
  onClose,
  onChanged,
}: {
  card: CardView;
  boardId: string;
  template: CardField[];
  columns: ColumnView[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body);
  const [values, setValues] = useState<CardFieldValues>(card.fields ?? {});
  const [labels, setLabels] = useState(card.labels.join(", "));
  const [due, setDue] = useState(card.due_date ?? "");
  const [checklist, setChecklist] = useState<ChecklistItem[]>(card.checklist);
  const [newItem, setNewItem] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editable = card.can_edit;
  const col = columns.find((c) => c.id === card.column_id);

  useEffect(() => {
    getCardActivities(card.id).then(setActivities);
  }, [card.id, card.updated_at, card.column_id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = (patch?: { checklist?: ChecklistItem[] }) =>
    start(async () => {
      const r = await updateCard(card.id, {
        title,
        body,
        fields: template.length ? values : (card.fields ?? {}),
        labels: labels.split(",").map((s) => s.trim()).filter(Boolean),
        due_date: due || null,
        checklist: patch?.checklist ?? checklist,
      });
      if (!r.ok) return setError(r.error);
      setError("");
      onChanged();
    });

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-[rgba(20,27,54,.45)] sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="카드 상세"
        className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto bg-card p-6 shadow-[0_20px_60px_rgba(20,27,54,.35)] sm:rounded-[20px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="badge text-ink" style={{ background: col ? columnTint(col.color) : undefined }}>
            {col?.name}
          </span>
          <span className="text-sm text-muted">
            {card.author_name ?? (card.is_mine ? "나" : "익명")}
          </span>
          <button className="icon-btn ml-auto text-2xl leading-none" onClick={onClose} aria-label="닫기" title="닫기">
            ×
          </button>
        </div>

        {editable ? (
          <form
            className="flex flex-col gap-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div>
              <label className="label" htmlFor="card-title">
                제목
              </label>
              <input id="card-title" className="input" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <CardContentInputs template={template} body={body} onBody={setBody} values={values} onValues={setValues} idPrefix="card" />
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="card-labels">
                  라벨 (쉼표로 구분)
                </label>
                <input id="card-labels" className="input" value={labels} onChange={(e) => setLabels(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="card-due">
                  마감일
                </label>
                <input id="card-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
              </div>
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <div className="flex flex-row-reverse gap-2">
              <button className="btn-primary min-w-24" disabled={pending}>
                저장
              </button>
              <span className="flex-1" />
              {confirmDelete ? (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() =>
                    start(async () => {
                      const r = await deleteCard(card.id);
                      if (!r.ok) return setError(r.error);
                      onChanged();
                      onClose();
                    })
                  }
                >
                  정말 삭제
                </button>
              ) : (
                <button type="button" className="btn-danger" onClick={() => setConfirmDelete(true)}>
                  카드 삭제
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <h2 className="text-[26px] leading-snug break-keep">{card.title}</h2>
            <CardContentView card={card} template={template} />
            {card.labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {card.labels.map((l) => (
                  <span key={l} className="badge bg-surface text-muted">
                    {l}
                  </span>
                ))}
              </div>
            )}
            {card.due_date && <p className="text-sm text-muted">마감 {card.due_date}</p>}
          </div>
        )}

        <section className="border-t-2 border-surface pt-4">
          <h3 className="jua mb-2 text-xl">체크리스트</h3>
          <ul className="flex flex-col gap-1">
            {checklist.map((item, i) => (
              <li key={i} className="flex min-h-11 items-center gap-3 rounded-xl px-2 text-[15px] hover:bg-surface">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--primary)]"
                  checked={item.done}
                  disabled={!editable}
                  aria-label={item.text}
                  onChange={() => {
                    const next = checklist.map((c, k) => (k === i ? { ...c, done: !c.done } : c));
                    setChecklist(next);
                    save({ checklist: next });
                  }}
                />
                <span className={item.done ? "text-slate-400 line-through" : ""}>{item.text}</span>
                {editable && (
                  <button
                    className="ml-auto min-h-9 rounded-lg px-2 text-xs font-bold text-muted hover:bg-surface-hover hover:text-danger"
                    onClick={() => {
                      const next = checklist.filter((_, k) => k !== i);
                      setChecklist(next);
                      save({ checklist: next });
                    }}
                  >
                    빼기
                  </button>
                )}
              </li>
            ))}
          </ul>
          {editable && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newItem.trim()) return;
                const next = [...checklist, { text: newItem.trim(), done: false }];
                setChecklist(next);
                setNewItem("");
                save({ checklist: next });
              }}
            >
              <input className="input" placeholder="예: 자료 3개 찾기" aria-label="체크리스트 항목" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
              <button className="btn shrink-0">추가</button>
            </form>
          )}
        </section>

        <section className="border-t-2 border-surface pt-4">
          <h3 className="jua mb-2 text-xl">첨부</h3>
          <AttachmentDetail
            items={card.attachments}
            canEdit={editable}
            onDelete={(id) =>
              start(async () => {
                const r = await deleteAttachment(id);
                if (!r.ok) setError(r.error);
                onChanged();
              })
            }
          />
          {editable && (
            <div className="mt-2">
              <AttachmentUploader boardId={boardId} cardId={card.id} onDone={onChanged} />
            </div>
          )}
        </section>

        <section className="border-t-2 border-surface pt-4">
          <h3 className="jua mb-2 text-xl">활동 기록</h3>
          <ol className="flex flex-col gap-1.5 text-sm text-ink" data-testid="activity-list">
            {activities.map((a) => (
              <li key={a.id} data-testid="activity">
                <time className="mr-2 text-xs text-muted">{formatKST(a.created_at)}</time>
                {a.actor_name ?? "누군가"} — {ACTION_LABEL[a.action]}
                {a.action === "move" && ` (${a.from_column ?? "?"} → ${a.to_column ?? "?"})`}
              </li>
            ))}
            {activities.length === 0 && <li className="text-muted">기록이 없습니다.</li>}
          </ol>
        </section>
      </div>
    </div>
  );
}
