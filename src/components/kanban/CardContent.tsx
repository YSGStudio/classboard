"use client";

import { filledFields, MAX_FIELD_VALUE, type CardField, type CardFieldValues } from "@/lib/card-fields";
import type { CardView } from "@/lib/types";

/**
 * 카드 내용 입력칸. 보드 형식이 비어 있으면 기본 '내용' 한 칸, 아니면 교사가 만든 항목들.
 * (제목 칸은 부르는 쪽이 따로 그린다)
 */
export function CardContentInputs({
  template,
  body,
  onBody,
  values,
  onValues,
  idPrefix,
  compact,
}: {
  template: CardField[];
  body: string;
  onBody: (v: string) => void;
  values: CardFieldValues;
  onValues: (v: CardFieldValues) => void;
  idPrefix: string;
  compact?: boolean;
}) {
  if (template.length === 0) {
    return (
      <div>
        <label className="label" htmlFor={`${idPrefix}-body`}>
          내용
        </label>
        <textarea
          id={`${idPrefix}-body`}
          className={`input ${compact ? "h-24" : "h-28"}`}
          value={body}
          maxLength={2000}
          placeholder={compact ? "내용을 적어 주세요" : undefined}
          onChange={(e) => onBody(e.target.value)}
          data-testid="card-input-body"
        />
        {!compact && <p className="hint mt-1 text-right">{body.length}/2000</p>}
      </div>
    );
  }
  return (
    <>
      {template.map((f) => {
        const id = `${idPrefix}-f-${f.id}`;
        const set = (v: string) => onValues({ ...values, [f.id]: v });
        return (
          <div key={f.id}>
            <label className="label" htmlFor={id}>
              {f.label}
            </label>
            {f.type === "long" ? (
              <textarea
                id={id}
                className={`input ${compact ? "h-20" : "h-24"}`}
                value={values[f.id] ?? ""}
                maxLength={MAX_FIELD_VALUE}
                onChange={(e) => set(e.target.value)}
                data-testid="card-input-field"
              />
            ) : (
              <input
                id={id}
                className="input"
                value={values[f.id] ?? ""}
                maxLength={MAX_FIELD_VALUE}
                onChange={(e) => set(e.target.value)}
                data-testid="card-input-field"
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/** 카드 내용 보기: 형식 항목(레이블 + 값) 또는 기본 내용 */
export function CardContentView({
  card,
  template,
  preview,
}: {
  card: Pick<CardView, "body" | "fields">;
  template: CardField[];
  preview?: boolean;
}) {
  if (template.length === 0) {
    if (!card.body) return null;
    return preview ? (
      <span className="line-clamp-2 text-sm text-muted">{card.body}</span>
    ) : (
      <p className="whitespace-pre-wrap text-ink">{card.body}</p>
    );
  }
  const items = filledFields(template, card.fields);
  if (items.length === 0) return null;
  const shown = preview ? items.slice(0, 3) : items;
  return (
    <span className={`flex flex-col ${preview ? "gap-1" : "gap-3"}`} data-testid="card-fields">
      {shown.map((f) => (
        <span key={f.id} className="flex flex-col">
          <span className={`font-bold text-muted ${preview ? "text-[11px]" : "text-xs"}`}>{f.label}</span>
          <span className={preview ? "line-clamp-2 text-sm text-ink" : "whitespace-pre-wrap text-ink"}>{f.value}</span>
        </span>
      ))}
      {preview && items.length > shown.length && <span className="text-xs text-muted">… {items.length - shown.length}개 더</span>}
    </span>
  );
}
