"use client";

import { useEffect, useState, useTransition } from "react";
import type { Criterion } from "@/lib/criteria";
import { fmt1, maxStars, overallOutOf5, starLabel, teacherStars, type ReviewSummary, type Stars } from "@/lib/peer";
import { getMyPeerReview, getReviewSummary, savePeerReview } from "@/app/actions/peer";

/** 섹션 이름 '01. 이름' → '이름' */
export const memberName = (columnName: string) => columnName.replace(/^\d+\.\s*/, "");

function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-[rgba(20,27,54,.45)] sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="flex max-h-full w-full max-w-xl flex-col gap-4 overflow-y-auto bg-card p-6 shadow-[0_20px_60px_rgba(20,27,54,.35)] sm:rounded-[20px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 text-[26px] leading-tight break-keep">{label}</h2>
          <button className="icon-btn text-2xl leading-none" onClick={onClose} aria-label="닫기" title="닫기">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 별 입력: 1..max. 같은 별을 다시 누르면 지운다 */
function StarInput({ c, value, onChange }: { c: Criterion; value: number | undefined; onChange: (v: number | undefined) => void }) {
  const max = maxStars(c);
  return (
    <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={`${c.name} 별점`}>
      {Array.from({ length: max }, (_, i) => i + 1).map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          aria-label={`별 ${k}개 (${starLabel(c, k)})`}
          title={starLabel(c, k)}
          className={`text-3xl leading-none transition hover:scale-110 ${value !== undefined && k <= value ? "text-accent drop-shadow-[0_1px_0_rgba(0,0,0,.25)]" : "text-edge"}`}
          onClick={() => onChange(value === k ? undefined : k)}
          data-testid="star"
        >
          ★
        </button>
      ))}
      <span className="ml-2 text-sm text-muted">{value ? `${value}/${max} · ${starLabel(c, value)}` : "아직 안 골랐어요"}</span>
    </div>
  );
}

/** 별 보기 (소수 평균은 부분 채움) */
function StarMeter({ value, max }: { value: number | null; max: number }) {
  if (value === null) return <span className="text-sm text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative inline-block text-xl leading-none tracking-[2px] text-edge" aria-hidden>
        {"★".repeat(max)}
        <span className="absolute inset-0 overflow-hidden whitespace-nowrap text-accent" style={{ width: `${(value / max) * 100}%` }}>
          {"★".repeat(max)}
        </span>
      </span>
      <span className="text-sm font-bold text-ink">
        {fmt1(value)}
        <span className="font-normal text-muted">/{max}</span>
      </span>
    </span>
  );
}

/** 친구 평가하기: 교사가 붙인 평가 기준마다 별점 */
export function PeerReviewModal({
  boardId,
  target,
  criteria,
  onClose,
}: {
  boardId: string;
  target: { id: string; name: string };
  criteria: Criterion[];
  onClose: () => void;
}) {
  const [stars, setStars] = useState<Stars | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    // 늦게 온 응답이 이미 고른 별을 덮어쓰지 않도록, 처음 한 번만 채운다
    let alive = true;
    getMyPeerReview(boardId, target.id).then((s) => alive && setStars((cur) => cur ?? s));
    return () => {
      alive = false;
    };
  }, [boardId, target.id]);
  const done = stars ? criteria.filter((c) => stars[c.id]).length : 0;

  return (
    <Modal label={`⭐ ${target.name} 평가하기`} onClose={onClose}>
      <p className="text-sm text-muted">
        선생님이 정한 평가 기준마다 별을 골라 주세요. 누가 줬는지는 친구에게 보이지 않고, 평균만 보여요.
      </p>
      {stars === null ? (
        <p className="py-6 text-center text-sm text-muted">불러오는 중…</p>
      ) : (
        <form
          className="flex flex-col gap-4"
          data-testid="peer-review-form"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await savePeerReview(boardId, target.id, stars);
              if (!r.ok) return setMsg({ ok: false, text: r.error });
              setStars(r.data!.stars);
              setMsg({ ok: true, text: Object.keys(r.data!.stars).length ? "평가를 저장했어요." : "평가를 지웠어요." });
            });
          }}
        >
          {criteria.map((c) => (
            <fieldset key={c.id} className="flex flex-col gap-1.5 rounded-2xl bg-surface p-4">
              <legend className="sr-only">{c.name}</legend>
              <p className="jua text-xl">{c.name}</p>
              {c.description && <p className="text-xs text-muted">{c.description}</p>}
              <StarInput
                c={c}
                value={stars[c.id]}
                onChange={(v) =>
                  setStars((cur) => {
                    const n = { ...(cur ?? {}) };
                    if (v === undefined) delete n[c.id];
                    else n[c.id] = v;
                    return n;
                  })
                }
              />
            </fieldset>
          ))}
          {msg && (
            <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" : "alert-error"}>
              {msg.text}
            </p>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">
              {done}/{criteria.length}개 골랐어요
            </span>
            <button type="button" className="btn ml-auto" onClick={onClose}>
              닫기
            </button>
            <button className="btn-primary min-w-24" disabled={pending || (done === 0 && !msg)}>
              {pending ? "저장 중…" : "평가 저장"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** 내 평가 보기(학생 본인) / 학생 평가 보기(교사): 선생님 평가 + 친구들 평가 평균 */
export function ReviewSummaryModal({
  boardId,
  student,
  isTeacher,
  onClose,
}: {
  boardId: string;
  student: { id: string; name: string };
  isTeacher: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<ReviewSummary | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    getReviewSummary(boardId, student.id).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [boardId, student.id]);

  const criteria = data?.criteria ?? [];
  const tStars = data?.teacher ? teacherStars(criteria, data.teacher.levels) : null;
  const tOverall = tStars ? overallOutOf5(criteria, tStars) : null;
  const pOverall = data && data.peer_count > 0 ? overallOutOf5(criteria, data.peer_avg) : null;

  return (
    <Modal label={isTeacher ? `📊 ${student.name} 평가 보기` : "📊 내 평가 보기"} onClose={onClose}>
      {data === undefined ? (
        <p className="py-6 text-center text-sm text-muted">불러오는 중…</p>
      ) : data === null ? (
        <p className="py-6 text-center text-sm text-muted">평가를 볼 수 없어요.</p>
      ) : criteria.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">아직 이 작업장에 평가 기준이 없어요.</p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="review-summary">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 rounded-2xl bg-primary p-4 text-white">
              <span className="text-sm text-primary-soft">선생님 평가 총평균</span>
              <span className="jua text-4xl" data-testid="teacher-overall">
                {tOverall === null ? "—" : fmt1(tOverall)}
                <span className="text-lg text-primary-soft"> / 5</span>
              </span>
              {isTeacher && data.teacher && !data.teacher.published && <span className="text-xs text-accent">학생에게 아직 비공개</span>}
            </div>
            <div className="flex flex-col gap-1 rounded-2xl bg-done p-4 text-ink">
              <span className="text-sm text-muted">친구 평가 총평균</span>
              <span className="jua text-4xl" data-testid="peer-overall">
                {pOverall === null ? "—" : fmt1(pOverall)}
                <span className="text-lg text-muted"> / 5</span>
              </span>
              <span className="text-xs text-muted" data-testid="peer-count">
                {data.peer_count}명이 평가했어요
              </span>
            </div>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-surface text-muted">
                <th className="py-2 font-bold">평가 기준</th>
                <th className="py-2 font-bold">선생님</th>
                <th className="py-2 font-bold">친구들 평균</th>
              </tr>
            </thead>
            <tbody>
              {criteria.map((c) => (
                <tr key={c.id} className="border-b border-surface align-middle" data-testid="review-row">
                  <td className="py-2.5 pr-2 font-bold text-ink">{c.name}</td>
                  <td className="py-2.5 pr-2">
                    <StarMeter value={tStars?.[c.id] ?? null} max={maxStars(c)} />
                  </td>
                  <td className="py-2.5">
                    <StarMeter value={data.peer_avg[c.id] ?? null} max={maxStars(c)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.teacher && (
            <p className="rounded-xl bg-surface p-3 text-sm text-muted">
              {isTeacher ? "아직 이 학생을 평가하지 않았어요." : "선생님 평가는 아직 공개되지 않았어요."}
            </p>
          )}
          {data.teacher?.feedback && (
            <div className="rounded-2xl border-2 border-surface p-4">
              <p className="mb-1 text-sm font-bold text-muted">선생님 한마디</p>
              <p className="whitespace-pre-wrap text-ink">{data.teacher.feedback}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
