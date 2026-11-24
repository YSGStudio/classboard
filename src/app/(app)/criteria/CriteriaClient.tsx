"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Criterion } from "@/lib/criteria";
import { CriterionForm } from "@/components/criteria/CriterionForm";
import { copyCriterion, deleteCriterion } from "@/app/actions/criteria";

export function CriteriaClient({ criteria, locked }: { criteria: Criterion[]; locked: string[] }) {
  const router = useRouter();
  const lockedSet = new Set(locked);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <details className="card-panel">
        <summary className="cursor-pointer font-bold">새 기준 만들기</summary>
        <div className="mt-3">
          <CriterionForm onDone={() => router.refresh()} />
        </div>
      </details>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-3" data-testid="criteria-list">
        {criteria.map((c) => {
          const isLocked = lockedSet.has(c.id);
          return (
            <li key={c.id} className="card-panel" data-testid="criterion">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-bold">{c.name}</h2>
                {isLocked && <span className="rounded-lg bg-amber-100 px-2 text-xs text-amber-800">평가에 사용됨 · 단계 잠김</span>}
                <div className="ml-auto flex gap-2">
                  <button className="btn" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                    수정
                  </button>
                  <button
                    className="btn"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await copyCriterion(c.id);
                        if (!r.ok) setError(r.error);
                        router.refresh();
                      })
                    }
                  >
                    복사해서 수정
                  </button>
                  <button
                    className="btn-danger"
                    disabled={pending || isLocked}
                    onClick={() =>
                      start(async () => {
                        const r = await deleteCriterion(c.id);
                        if (!r.ok) setError(r.error);
                        router.refresh();
                      })
                    }
                  >
                    삭제
                  </button>
                </div>
              </div>
              {c.description && <p className="text-sm text-slate-600">{c.description}</p>}
              <ol className="mt-2 flex flex-wrap gap-2 text-sm">
                {c.levels.map((l, i) => (
                  <li key={i} className="rounded-lg bg-surface px-2.5 py-1">
                    {l.name} ({l.score})
                  </li>
                ))}
              </ol>
              {editing === c.id && (
                <div className="mt-3 border-t-2 border-surface pt-3">
                  <CriterionForm
                    criterion={c}
                    locked={isLocked}
                    onDone={() => {
                      setEditing(null);
                      router.refresh();
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
        {criteria.length === 0 && <li className="text-slate-500">기준이 없습니다.</li>}
      </ul>
    </div>
  );
}
