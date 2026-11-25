"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Criterion } from "@/lib/criteria";
import { saveEvaluation, setEvaluationPublished } from "@/app/actions/evaluations";
import { formatKST } from "@/lib/datetime";

type Initial = { levels: Record<string, number>; feedback: string; published: boolean; updated_at: string } | null;

export function EvaluationForm({
  boardId,
  studentId,
  criteria,
  initial,
  prevHref,
  nextHref,
}: {
  boardId: string;
  studentId: string;
  criteria: Criterion[];
  initial: Initial;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const router = useRouter();
  const [levels, setLevels] = useState<Record<string, number>>(initial?.levels ?? {});
  const [feedback, setFeedback] = useState(initial?.feedback ?? "");
  const [published, setPublished] = useState(initial?.published ?? false);
  const [status, setStatus] = useState(initial ? `저장됨 ${formatKST(initial.updated_at, "time")}` : "");
  const [pending, start] = useTransition();
  const dirty = useRef(false);
  const latest = useRef({ levels, feedback });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    setStatus("저장 중…");
    const r = await saveEvaluation(boardId, studentId, latest.current.levels, latest.current.feedback);
    setStatus(r.ok ? `저장됨 ${formatKST(r.data!.updated_at, "time")}` : `저장 실패: ${r.error}`);
  };

  const change = (next: { levels?: Record<string, number>; feedback?: string }) => {
    latest.current = { levels: next.levels ?? latest.current.levels, feedback: next.feedback ?? latest.current.feedback };
    if (next.levels) setLevels(next.levels);
    if (next.feedback !== undefined) setFeedback(next.feedback);
    dirty.current = true;
    setStatus("입력 중…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };

  useEffect(() => {
    return () => {
      // 화면을 떠날 때 남은 변경 저장
      if (dirty.current) void saveEvaluation(boardId, studentId, latest.current.levels, latest.current.feedback);
    };
  }, [boardId, studentId]);

  const go = (href: string) => async () => {
    await flush();
    router.push(href);
  };

  return (
    <aside className="card-panel flex h-fit flex-col gap-4 lg:sticky lg:top-16" aria-label="평가 입력">
      {criteria.length === 0 && <p className="text-sm text-slate-600">이 보드에 붙은 평가 기준이 없습니다. 보드 설정에서 기준을 붙이세요.</p>}
      {criteria.map((c) => (
        <fieldset key={c.id} className="flex flex-col gap-1">
          <legend className="font-bold">{c.name}</legend>
          {c.description && <p className="text-xs text-slate-500">{c.description}</p>}
          <div className="flex flex-wrap gap-2">
            {c.levels.map((l, i) => (
              <label
                key={i}
                className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${levels[c.id] === i ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"}`}
                title={l.description}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`level-${c.id}`}
                  checked={levels[c.id] === i}
                  onChange={() => change({ levels: { ...latest.current.levels, [c.id]: i } })}
                />
                {l.name} ({l.score})
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div>
        <label className="label" htmlFor="feedback">
          피드백
        </label>
        <textarea
          id="feedback"
          className="input h-40"
          maxLength={2000}
          value={feedback}
          onChange={(e) => change({ feedback: e.target.value })}
          onBlur={flush}
        />
        <p className="flex justify-between text-xs text-slate-500">
          <span data-testid="save-status">{status}</span>
          <span>{feedback.length}/2000</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={published ? "btn" : "btn-primary"}
          disabled={pending}
          onClick={() =>
            start(async () => {
              dirty.current = true;
              await flush();
              const r = await setEvaluationPublished(boardId, studentId, !published);
              if (r.ok) setPublished(!published);
            })
          }
        >
          {published ? "공개 취소" : "이 학생 평가 공개"}
        </button>
        <span className="text-sm" data-testid="published-state">
          {published ? "공개됨" : "비공개"}
        </span>
      </div>
      <div className="flex justify-between gap-2 border-t-2 border-surface pt-3">
        {prevHref ? (
          <Link href={prevHref} className="btn" onClick={(e) => { e.preventDefault(); go(prevHref)(); }}>
            ← 이전 학생
          </Link>
        ) : (
          <span />
        )}
        {nextHref && (
          <Link href={nextHref} className="btn" onClick={(e) => { e.preventDefault(); go(nextHref)(); }}>
            다음 학생 →
          </Link>
        )}
      </div>
    </aside>
  );
}
